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
        'admin 令牌拥有全部权限，旧版主令牌等价于 admin。',
        '浏览器页面不走 Bearer：它先 POST /api/session 用令牌换一个 HttpOnly 会话 Cookie，',
        '之后的请求由浏览器自动携带该 Cookie（页面脚本读不到令牌原文）。'
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
        QueueSettings: {
          type: 'object',
          description: '队列设置（只读；改动请回桌面端设置页）',
          properties: {
            maxConcurrent: { type: 'number', description: '最大同时下载数（桌面端只读，1-16）' },
            retryEnabled: { type: 'boolean', description: '是否启用失败自动重试' },
            retryMaxAttempts: { type: 'number', description: '最大重试次数' },
            retryDelaySeconds: { type: 'number', description: '重试间隔（秒）' }
          }
        },
        QueueResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            settings: { $ref: '#/components/schemas/QueueSettings' },
            tasks: { type: 'array', items: { $ref: '#/components/schemas/TaskSummary' }, description: '等待中的任务（最多 100 条）' },
            total: { type: 'number', description: '等待中的任务数' }
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
      '/api/session': {
        post: {
          summary: '用令牌或一次性配对码换取 HttpOnly 会话 Cookie（Web 控制台页面登录用）',
          description: '凭据放在请求体而不是请求头，因此本接口本身不需要 Authorization。token 传主令牌或细粒度令牌；首次配对时改传 pairingCode（设置页生成的 8 位一次性码，5 分钟有效、用后即焚）。成功后响应带 Set-Cookie（HttpOnly、SameSite=Strict，HTTPS 监听时另加 Secure），后续请求由浏览器自动携带。',
          tags: ['会话'],
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string', description: '主令牌或细粒度令牌原文（与 pairingCode 二选一）' },
                    pairingCode: { type: 'string', description: '首次配对一次性码（与 token 二选一）' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: '已登录，响应头 Set-Cookie 带会话，body 返回该令牌的 scopes', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, scopes: { type: 'array', items: { type: 'string' } } } } } } },
            400: { description: '请求体不是合法 JSON', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            401: { description: '令牌错误（Unauthorized）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        },
        delete: {
          summary: '退出登录（清除会话 Cookie）',
          tags: ['会话'],
          security: [],
          responses: {
            200: { description: '已退出，响应头 Set-Cookie 把会话置空（Max-Age=0）', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
            401: { description: '未登录时也可能返回（不影响客户端继续清理本地状态）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        }
      },
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
      '/api/events': {
        get: {
          summary: '订阅任务状态变化（Server-Sent Events，持续推送）',
          description: '连接保持打开，服务端在状态变化时推送 event: status（data 为与 /api/status 相同的 JSON），每 25 秒发送一次注释行心跳。无变化不重复推送。浏览器端 EventSource 无法自定义请求头，因此页面使用 fetch + ReadableStream 携带 Bearer 令牌消费本接口。',
          tags: ['任务'],
          security: securityRequirement(),
          responses: {
            200: { description: '事件流（text/event-stream）', content: { 'text/event-stream': { schema: { type: 'string' } } } },
            401: { description: '缺少或错误的令牌', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            403: { description: '令牌权限不足（需 tasks:read）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            503: { description: '并发订阅数超过上限（too_many_streams）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
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
                    uris: { type: 'array', items: { type: 'string' }, description: 'http/https/ftp/sftp 链接或磁力链接（最多 200 条）' },
                    dir: { type: 'string', description: '下载目录（可选）：下载根目录内的绝对路径，或相对下载根目录的子目录；越界返回 dir_outside_download_root' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: '已添加，返回新任务 gid', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, gid: { type: 'string' } } } } } },
            400: { description: 'uris 缺失、超过 200 条、协议不在白名单（invalid_uri）或 dir 越界（dir_outside_download_root）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            401: { description: '缺少或错误的令牌', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            403: { description: '令牌权限不足（需 tasks:write）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
          }
        }
      },
      '/api/tasks/{action}': {
        post: {
          summary: '批量控制任务：pauseAll / unpauseAll',
          tags: ['任务'],
          security: securityRequirement(),
          parameters: [
            { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['pauseAll', 'unpauseAll'] } }
          ],
          responses: {
            200: { description: '操作已提交', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
            401: { description: '缺少或错误的令牌', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            403: { description: '令牌权限不足（需 tasks:control）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
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
      '/api/queue': {
        get: {
          summary: '读取队列视图（队列设置 + 等待中的任务，只读）',
          tags: ['任务'],
          security: securityRequirement(),
          responses: {
            200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/QueueResponse' } } } },
            401: { description: '缺少或错误的令牌', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            403: { description: '令牌权限不足（需 tasks:read）', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
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
