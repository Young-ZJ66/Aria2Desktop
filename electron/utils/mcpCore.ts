/**
 * MCP（Model Context Protocol）端点核心：工具定义、JSON-RPC 响应构造、参数校验。
 *
 * 为什么内置 MCP：AI 客户端（Claude Desktop / Cursor / 各类 Agent）可以用自然语言
 * 直接驱动下载——"把这个链接下了""下完暂停"——无需用户手动点界面。Gopeed 已先行，
 * 本项目复用既有本地接口（Bearer 鉴权 + SSRF 白名单）即可低成本跟进。
 *
 * 协议：JSON-RPC 2.0（MCP 基础协议）。实现最小可用子集：
 *   initialize / tools/list / tools/call / notifications/*（忽略）
 * 传输：Streamable HTTP 的简化形态——单次 POST 请求-响应（不支持 SSE 流式）。
 *
 * 安全：工具集只覆盖下载管理（添加/查询/暂停/恢复），不暴露文件系统操作；
 * URL 仍走 isAllowedDownloadUri 白名单（在 extensionApiServer 内校验）。
 */

export const MCP_PROTOCOL_VERSION = '2024-11-05'
export const MCP_SERVER_NAME = 'aria2-desktop'

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
}

/** 暴露给 AI 客户端的工具清单（描述写给模型看，需明确副作用与参数语义） */
export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'add_download',
    description:
      'Add a download task to Aria2 Desktop. Supports http/https/ftp URLs and magnet links. The app applies its own category folders and duplicate detection.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL or magnet link to download' },
        fileName: { type: 'string', description: 'Optional explicit file name for the download' }
      },
      required: ['url']
    }
  },
  {
    name: 'list_tasks',
    description:
      'List download tasks with concise status. Use the status filter to narrow down: active (downloading), waiting (queued or paused), stopped (completed or failed).',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by task state; omit to list active and waiting tasks',
          enum: ['active', 'waiting', 'stopped', 'all']
        },
        limit: { type: 'number', description: 'Maximum number of tasks to return (default 20)' }
      }
    }
  },
  {
    name: 'get_download_status',
    description:
      'Get overall download statistics: global speed, number of active/waiting/stopped tasks, and engine availability.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'pause_task',
    description: 'Pause a download task by its gid. Use list_tasks to obtain gids.',
    inputSchema: {
      type: 'object',
      properties: { gid: { type: 'string', description: 'Task gid shown by list_tasks' } },
      required: ['gid']
    }
  },
  {
    name: 'resume_task',
    description: 'Resume (unpause) a paused download task by its gid.',
    inputSchema: {
      type: 'object',
      properties: { gid: { type: 'string', description: 'Task gid shown by list_tasks' } },
      required: ['gid']
    }
  }
]

/** JSON-RPC 成功响应 */
export function mcpResult(id: string | number | null, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}

/** JSON-RPC 错误响应 */
export function mcpError(
  id: string | number | null,
  code: number,
  message: string
): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** MCP 标准错误码（JSON-RPC 保留段） */
export const MCP_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603
} as const

/** initialize 响应（协议协商结果） */
export function buildInitializeResult(serverVersion: string): Record<string, unknown> {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: MCP_SERVER_NAME, version: serverVersion }
  }
}

/** tools/list 响应 */
export function buildToolsListResult(): Record<string, unknown> {
  return { tools: MCP_TOOLS }
}

/** tools/call 的 success 包装 */
export function buildToolTextResult(text: string): Record<string, unknown> {
  return { content: [{ type: 'text', text }] }
}

/** tools/call 的 error 包装（isError 让模型知道调用失败） */
export function buildToolErrorResult(text: string): Record<string, unknown> {
  return { content: [{ type: 'text', text }], isError: true }
}

/**
 * 判断 JSON-RPC 消息是否通知（无 id）：通知不应有响应体（HTTP 202）。
 */
export function isNotification(message: { id?: unknown }): boolean {
  return message.id === undefined || message.id === null
}

/** 校验 tools/call 的参数形状：返回工具名与 arguments，非法时返回 error 文案 */
export function parseToolCallParams(
  params: unknown
): { toolName: string; args: Record<string, unknown> } | { error: string } {
  if (typeof params !== 'object' || params === null) return { error: 'params must be an object' }
  const p = params as { name?: unknown; arguments?: unknown }
  if (typeof p.name !== 'string' || !p.name.trim()) return { error: 'params.name must be a non-empty string' }
  const args =
    typeof p.arguments === 'object' && p.arguments !== null ? (p.arguments as Record<string, unknown>) : {}
  return { toolName: p.name.trim(), args }
}

/** 从工具参数中取字符串（缺失返回 undefined，非字符串返回 null 表示非法） */
export function optString(args: Record<string, unknown>, key: string): string | undefined | null {
  const v = args[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** 从工具参数中取数字（缺失返回 defaultValue；非法返回 null） */
export function optNumber(args: Record<string, unknown>, key: string, defaultValue: number): number | null {
  const v = args[key]
  if (v === undefined || v === null) return defaultValue
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.trunc(v)
}

/** 任务名解析所需的字段（与 aria2 tellStatus 返回形状对齐） */
export interface TaskNameInput {
  gid?: unknown
  bittorrent?: { info?: { name?: unknown } }
  files?: Array<{ path?: unknown; uris?: Array<{ uri?: unknown }> }>
}

/**
 * 任务显示名：BT 名 → 文件路径末段 → URI 末段 → gid。
 *
 * 为什么需要 URI 兜底：下载尚未开始时 aria2 的 files[].path 为空串，
 * 而 AI 客户端只能看到这里给的名字——为空就完全无法分辨任务是哪个。
 * 实测（v1.2.3 打包版）：错误/未开始任务若只取 path，name 全是空串。
 */
export function pickTaskName(task: TaskNameInput): string {
  const btName = task.bittorrent?.info?.name
  if (typeof btName === 'string' && btName.trim()) return btName.trim()

  const files = Array.isArray(task.files) ? task.files : []
  for (const f of files) {
    const p = typeof f.path === 'string' ? f.path : ''
    if (!p) continue
    const base = p.split(/[\\/]/).pop()
    if (base) return base
  }

  for (const f of files) {
    const uris = Array.isArray(f.uris) ? f.uris : []
    for (const u of uris) {
      const uri = typeof u.uri === 'string' ? u.uri : ''
      if (!uri) continue
      try {
        const url = new URL(uri)
        const last = url.pathname.split('/').filter(Boolean).pop() ?? ''
        const decoded = decodeURIComponent(last)
        if (decoded) return decoded
      } catch {
        // magnet / 非法 URI：跳过（它们的文件名在 dn 参数里，不在此处展开）
      }
    }
  }

  return typeof task.gid === 'string' ? task.gid : ''
}
