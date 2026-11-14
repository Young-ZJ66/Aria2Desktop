/**
 * Web 控制台 OpenAPI 3.0.3 文档
 *
 * 供第三方客户端（手机 App、自动化脚本、API 调试工具）直接消费。
 * 不引入 swagger 依赖：文档是静态结构，手写比引入一整套生成器更轻。
 */

import type { WebConsoleScope } from '../src/shared/appSettings'

/** 各权限范围的中文说明（同时用于文档 description 与设置页提示） */
const SCOPE_DESCRIPTIONS: Record<WebConsoleScope, string> = {
  'tasks:read': '读取任务列表与全局统计',
  'tasks:write': '添加下载任务',
  'tasks:control': '暂停、恢复、删除任务',
  'audit:read': '读取操作审计记录',
  admin: '全部权限（含以上所有）'
}

function securityRequirement(): { bearerAuth: WebConsoleScope[] }[] {
  return [{ bearerAuth: [] }]
}

export function buildOpenApiDocument(appVersion: string): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Aria2 Desktop Web Console API',
      version: appVersion,
      description: [
        'Aria2 Desktop 的远程控制接口。除登录页、静态资源与本文档外，所有请求都需要',
        'Authorization: Bearer <令牌>。令牌在 设置 → 高级 → 远程 Web 控制台 中创建，',
        '并按 tasks:read / tasks:write / tasks:control / audit:read 分配权限；',
        'admin 令牌拥有全部权限，旧版主令牌等价于 admin。'
      ].join('')
    },
    servers: [{ url: '/', description: '当前实例' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: (Object.keys(SCOPE_DESCRIPTIONS) as WebConsoleScope[])
            .map(scope => scope + ': ' + SCOPE_DESCRIPTIONS[scope])
            .join('; ')
        }
      },
      schemas: {
        TaskSummary: {
          type: 'object',
          properties: {
            gid: { type: 'string', description: '任务 GID' },
            status: { type: 'string', description: 'active / waiting / paused / complete / error / removed' },
            name: { type: 'string', description: '文件名或首个 URI' },
            totalLength: { type: 'string', description: '总字节数（字符串，与 aria2 一致）' },
            completedLength: { type: 'string', description: '已完成字节数' },
            downloadSpeed: { type: 'string', description: '当前下载速度（字节/秒）' }
          }
        },
        StatusResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            globalStat: { type: 'object', description: 'aria2.getGlobalStat 原样返回' },
            active: { type: 'array', items: { $ref: '#/components/schemas/TaskSummary' } },
            waiting: { type: 'array', items: { $ref: '#/components/schemas/TaskSummary' } },
            stopped: { type: 'array', items: { $ref: '#/components/schemas/TaskSummary' } }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: false },
            error: { type: 'string', description: '错误说明；权限不足时为 insufficient_scope' }
          }
        }
      }
    },
    paths: {
      '/api/status': {
        get: {
          summary: '读取全局统计与任务列表（活动/等待/已停止各最多 100 条）',
          tags: ['任务'],
          security: securityRequirement(),
          responses: {
            200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/StatusResponse' } } } },
            401: { description: '缺少或错误的令牌', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            403: { description: '令牌权限不足（需 tasks:read）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        }
      },
      '/api/tasks': {
        post: {
          summary: '添加下载任务',
          tags: ['任务'],
          security: securityRequirement(),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['uris'],
                  properties: {
                    uris: { type: 'array', items: { type: 'string' }, description: 'http/https/ftp 链接或磁力链接' },
                    dir: { type: 'string', description: '下载目录（可选）' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: '已添加，返回新任务 gid', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, gid: { type: 'string' } } } } } },
            400: { description: 'uris 缺失或非法', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            401: { description: '缺少或错误的令牌', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            403: { description: '令牌权限不足（需 tasks:write）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        }
      },
      '/api/tasks/{gid}/{action}': {
        post: {
          summary: '控制任务：pause / resume / remove',
          tags: ['任务'],
          security: securityRequirement(),
          parameters: [
            { name: 'gid', in: 'path', required: true, schema: { type: 'string' }, description: '任务 GID' },
            { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['pause', 'resume', 'remove'] } }
          ],
          responses: {
            200: { description: '操作已提交', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
            401: { description: '缺少或错误的令牌', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            403: { description: '令牌权限不足（需 tasks:control）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        }
      },
      '/api/audit': {
        get: {
          summary: '读取最近 100 条操作审计记录（新→旧）',
          tags: ['审计'],
          security: securityRequirement(),
          responses: {
            200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, items: { type: 'array', items: { type: 'object' } } } } } } },
            401: { description: '缺少或错误的令牌', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            403: { description: '令牌权限不足（需 audit:read）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        }
      },
      '/openapi.json': {
        get: {
          summary: '本文档（免鉴权）',
          tags: ['元信息'],
          responses: {
            200: { description: 'OpenAPI 3.0.3 文档', content: { 'application/json': { schema: { type: 'object' } } } }
          }
        }
      }
    }
  }
}
