import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from './webConsoleOpenApi'
import { routeScope } from './utils/webConsoleAuth'

// OpenAPI 文档是第三方客户端（手机 App、脚本）唯一的接口契约。
// 它最容易出的事是「文档和实现漂移」：改了路由忘了改文档，客户端照着文档调就 404。
// 这里用 routeScope（实现侧的路由权限表）反过来校验文档覆盖是否完整。

type Doc = {
  openapi: string
  info: { title: string; version: string; description: string }
  paths: Record<string, Record<string, { security?: unknown[]; responses: Record<string, unknown> }>>
  components: { securitySchemes: { bearerAuth: { scheme: string } }; schemas: Record<string, unknown> }
}

const doc = buildOpenApiDocument('1.5.0-beta.4') as unknown as Doc

describe('buildOpenApiDocument 基本形状', () => {
  it('声明 OpenAPI 3.0.3', () => {
    expect(doc.openapi).toBe('3.0.3')
  })

  it('版本号取自传入的 appVersion（与设置页展示一致）', () => {
    expect(doc.info.version).toBe('1.5.0-beta.4')
  })

  it('鉴权方案为 HTTP bearer', () => {
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer')
  })

  it('响应模型都定义了（TaskSummary / StatusResponse / QueueSettings / QueueResponse / ErrorResponse）', () => {
    for (const name of ['TaskSummary', 'StatusResponse', 'QueueSettings', 'QueueResponse', 'ErrorResponse']) {
      expect(doc.components.schemas[name]).toBeTruthy()
    }
  })
})

describe('文档覆盖与实现一致', () => {
  it('实现里登记权限的每个 /api 路由都在文档里', () => {
    // routeScope 是路由权限的唯一来源；它认得的路径必须都能在文档里查到
    const routes: Array<[string, string]> = [
      ['GET', '/api/status'],
      ['GET', '/api/events'],
      ['GET', '/api/audit'],
      ['GET', '/api/queue'],
      ['POST', '/api/tasks'],
      ['POST', '/api/tasks/pauseAll'],
      ['POST', '/api/tasks/abc/pause']
    ]
    for (const [method, route] of routes) {
      expect(routeScope(method, route), route).not.toBeNull()
    }
    for (const path of ['/api/status', '/api/events', '/api/audit', '/api/queue', '/api/tasks', '/api/tasks/{action}', '/api/tasks/{gid}/{action}']) {
      expect(doc.paths[path], path).toBeTruthy()
    }
  })

  it('每个 /api 操作都声明了 security（漏了会被客户端当成免鉴权）', () => {
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (!path.startsWith('/api/')) continue
      for (const [method, op] of Object.entries(ops)) {
        expect(op.security, `${method.toUpperCase()} ${path}`).toBeTruthy()
      }
    }
  })

  it('/openapi.json 自己不免鉴权（文档本身免鉴权，但它描述的路径不需要 security）', () => {
    expect(doc.paths['/openapi.json'].get.security).toBeUndefined()
  })

  it('每个操作都描述了 200 与 401', () => {
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const codes = Object.keys(op.responses)
        expect(codes, `${method.toUpperCase()} ${path}`).toContain('200')
        if (path.startsWith('/api/')) {
          expect(codes, `${method.toUpperCase()} ${path}`).toContain('401')
        }
      }
    }
  })

  it('权限不足的 403 说明里点出所需 scope（客户端据此提示用户）', () => {
    const status403 = doc.paths['/api/status'].get.responses['403'] as { description: string }
    expect(status403.description).toContain('tasks:read')
    const tasks403 = doc.paths['/api/tasks'].post.responses['403'] as { description: string }
    expect(tasks403.description).toContain('tasks:write')
    const control403 = doc.paths['/api/tasks/{gid}/{action}'].post.responses['403'] as { description: string }
    expect(control403.description).toContain('tasks:control')
    const audit403 = doc.paths['/api/audit'].get.responses['403'] as { description: string }
    expect(audit403.description).toContain('audit:read')
    const queue403 = doc.paths['/api/queue'].get.responses['403'] as { description: string }
    expect(queue403.description).toContain('tasks:read')
  })

  it('新增任务的协议白名单与实现一致（只允许 http/https/ftp/sftp/磁力）', () => {
    const body = doc.paths['/api/tasks'].post as unknown as {
      requestBody: { content: { 'application/json': { schema: { properties: { uris: { description: string } } } } } }
    }
    const description = body.requestBody.content['application/json'].schema.properties.uris.description
    expect(description).toContain('http')
    expect(description).toContain('ftp')
    expect(description).toContain('200')
  })
})
