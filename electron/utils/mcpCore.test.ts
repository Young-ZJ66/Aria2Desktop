import { describe, expect, it } from 'vitest'
import {
  MCP_CONFIRM_REQUIRED_TOOLS,
  MCP_PROTOCOL_VERSION,
  MCP_ERROR_CODES,
  MCP_TASK_NAME_MAX_LENGTH,
  MCP_TOOLS,
  MCP_TOOL_SCOPES,
  buildInitializeResult,
  buildToolErrorResult,
  buildToolTextResult,
  buildToolsListResult,
  isNotification,
  mcpError,
  mcpResult,
  optConfirm,
  optNumber,
  optString,
  parseToolCallParams,
  pickTaskName,
  sanitizeTaskName
} from './mcpCore'

describe('mcpResult / mcpError', () => {
  it('成功响应是 JSON-RPC 2.0 形状', () => {
    expect(mcpResult(1, { ok: true })).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })
  })

  it('错误响应带 code 与 message', () => {
    expect(mcpError('x', MCP_ERROR_CODES.invalidParams, 'bad')).toEqual({
      jsonrpc: '2.0',
      id: 'x',
      error: { code: -32602, message: 'bad' }
    })
  })
})

describe('buildInitializeResult', () => {
  it('声明 tools 能力与协议版本', () => {
    const r = buildInitializeResult('1.2.3') as {
      protocolVersion: string
      capabilities: { tools: unknown; resources: unknown; prompts: unknown }
      serverInfo: { name: string; version: string }
    }
    expect(r.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(r.capabilities.tools).toEqual({})
    expect(r.capabilities.resources).toEqual({})
    expect(r.capabilities.prompts).toEqual({})
    expect(r.serverInfo).toEqual({ name: 'aria2-desktop', version: '1.2.3' })
  })
})

describe('buildToolsListResult', () => {
  it('工具清单含核心与扩展工具且 inputSchema 合法', () => {
    const r = buildToolsListResult() as { tools: Array<{ name: string; inputSchema: { type: string } }> }
    expect(r.tools.map(t => t.name)).toEqual([
      'add_download',
      'list_tasks',
      'get_download_status',
      'get_task_status',
      'pause_task',
      'resume_task',
      'remove_task',
      'pause_all',
      'resume_all',
      'set_speed_limit',
      'get_global_stats',
      'get_version',
      'get_session_info',
      'get_task_peers',
      'get_task_servers',
      'get_task_files',
      'change_task_position',
      'set_task_speed_limit',
      'set_max_concurrent',
      'get_global_options',
      'purge_download_result',
      'save_session'
    ])
    for (const t of r.tools) expect(t.inputSchema.type).toBe('object')
  })
})

describe('isNotification', () => {
  it('无 id 或 id 为 null 视为通知', () => {
    expect(isNotification({})).toBe(true)
    expect(isNotification({ id: null })).toBe(true)
    expect(isNotification({ id: 0 })).toBe(false)
    expect(isNotification({ id: 'abc' })).toBe(false)
  })
})

describe('parseToolCallParams', () => {
  it('解析 name 与 arguments', () => {
    expect(parseToolCallParams({ name: 'list_tasks', arguments: { limit: 5 } })).toEqual({
      toolName: 'list_tasks',
      args: { limit: 5 }
    })
  })

  it('arguments 缺省为空对象', () => {
    expect(parseToolCallParams({ name: 'get_download_status' })).toEqual({
      toolName: 'get_download_status',
      args: {}
    })
  })

  it('非法 params 返回 error', () => {
    expect(parseToolCallParams(null)).toEqual({ error: 'params must be an object' })
    expect(parseToolCallParams({ name: '  ' })).toEqual({ error: 'params.name must be a non-empty string' })
    expect(parseToolCallParams({ name: 42 })).toEqual({ error: 'params.name must be a non-empty string' })
  })
})

describe('optString / optNumber', () => {
  it('optString：缺失 undefined，空白当缺失，非字符串 null', () => {
    expect(optString({}, 'url')).toBeUndefined()
    expect(optString({ url: '  ' }, 'url')).toBeUndefined()
    expect(optString({ url: ' https://a.com/x ' }, 'url')).toBe('https://a.com/x')
    expect(optString({ url: 123 }, 'url')).toBeNull()
  })

  it('optNumber：缺失回默认，非法 null，小数取整', () => {
    expect(optNumber({}, 'limit', 20)).toBe(20)
    expect(optNumber({ limit: 5.7 }, 'limit', 20)).toBe(5)
    expect(optNumber({ limit: 'x' }, 'limit', 20)).toBeNull()
    expect(optNumber({ limit: Number.NaN }, 'limit', 20)).toBeNull()
  })
})

describe('tool result wrappers', () => {
  it('成功内容是 text content', () => {
    expect(buildToolTextResult('done')).toEqual({ content: [{ type: 'text', text: 'done' }] })
  })

  it('失败标 isError', () => {
    expect(buildToolErrorResult('nope')).toEqual({
      content: [{ type: 'text', text: 'nope' }],
      isError: true
    })
  })
})

describe('pickTaskName', () => {
  it('BT 任务优先用 info.name', () => {
    expect(
      pickTaskName({
        gid: 'g1',
        bittorrent: { info: { name: 'Ubuntu 24.04' } },
        files: [{ path: '/dl/Ubuntu 24.04.iso' }]
      })
    ).toBe('Ubuntu 24.04')
  })

  it('普通任务取文件路径末段', () => {
    expect(pickTaskName({ gid: 'g2', files: [{ path: 'D:/Downloads/movie.mkv' }] })).toBe('movie.mkv')
  })

  it('路径为空（未开始/失败任务）回落到 URI 末段', () => {
    expect(
      pickTaskName({
        gid: 'g3',
        files: [{ path: '', uris: [{ uri: 'https://speed.cloudflare.com/__down?bytes=100' }] }]
      })
    ).toBe('__down')
  })

  it('URI 末段做 URL 解码', () => {
    expect(
      pickTaskName({ gid: 'g4', files: [{ path: '', uris: [{ uri: 'https://a.com/%E6%B5%8B%E8%AF%95.zip' }] }] })
    ).toBe('测试.zip')
  })

  it('magnet 等无法取名的 URI 跳过，最终回落 gid', () => {
    expect(pickTaskName({ gid: 'g5', files: [{ path: '', uris: [{ uri: 'magnet:?xt=urn:btih:abc' }] }] })).toBe('g5')
  })

  it('URI 条目缺少 uri 字段时跳过，继续看后面的条目', () => {
    expect(
      pickTaskName({
        gid: 'g9',
        files: [{ path: '', uris: [{}, { uri: '' }, { uri: 'https://a.com/real.zip' }] }]
      } as never)
    ).toBe('real.zip')
  })

  it('无 files 时回落 gid；异常形状不抛错', () => {
    expect(pickTaskName({ gid: 'g6' })).toBe('g6')
    expect(pickTaskName({} as never)).toBe('')
  })

  it('任务名清洗控制字符与双向覆盖符（提示注入面）', () => {
    // BT 名来自远端，可以塞 ANSI 转义 / RTL 覆盖符 / 超长文本
    expect(sanitizeTaskName('evil\u001b[31mname')).toBe('evil [31mname')
    expect(sanitizeTaskName('invoice\u202Egnp.exe')).toBe('invoice gnp.exe')
    expect(sanitizeTaskName('  a\n\tb  ')).toBe('a b')
    expect(sanitizeTaskName('')).toBe('')
  })

  it('任务名超长时截断并加省略号', () => {
    const long = 'x'.repeat(MCP_TASK_NAME_MAX_LENGTH + 50)
    const out = sanitizeTaskName(long)
    expect(out.length).toBe(MCP_TASK_NAME_MAX_LENGTH + 1)
    expect(out.endsWith('…')).toBe(true)
  })

  it('pickTaskName 对 BT 名与文件名都做清洗', () => {
    expect(
      pickTaskName({ gid: 'g7', bittorrent: { info: { name: 'a\u0000b' } } })
    ).toBe('a b')
    expect(
      pickTaskName({ gid: 'g8', files: [{ path: '/dl/evil\u202Ename.bin' }] })
    ).toBe('evil name.bin')
  })
})

describe('MCP 工具标注与权限', () => {
  it('22 个工具全部带 annotations', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.annotations, `${tool.name} 缺少 annotations`).toBeTruthy()
    }
  })

  it('只读工具标 readOnlyHint，写操作不标', () => {
    const byName = new Map(MCP_TOOLS.map(t => [t.name, t]))
    expect(byName.get('list_tasks')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('get_global_stats')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('remove_task')?.annotations?.readOnlyHint).toBe(false)
    expect(byName.get('add_download')?.annotations?.readOnlyHint).toBe(false)
  })

  it('破坏性工具标 destructiveHint', () => {
    const byName = new Map(MCP_TOOLS.map(t => [t.name, t]))
    expect(byName.get('remove_task')?.annotations?.destructiveHint).toBe(true)
    expect(byName.get('purge_download_result')?.annotations?.destructiveHint).toBe(true)
    expect(byName.get('pause_task')?.annotations?.destructiveHint).toBeUndefined()
  })

  it('每个工具都有 scope 映射，且破坏性工具要求 confirm', () => {
    for (const tool of MCP_TOOLS) {
      expect(MCP_TOOL_SCOPES[tool.name], `${tool.name} 缺少 scope 映射`).toBeTruthy()
    }
    const byName = new Map(MCP_TOOLS.map(t => [t.name, t]))
    for (const name of MCP_CONFIRM_REQUIRED_TOOLS) {
      expect(byName.get(name)?.inputSchema.required).toContain('confirm')
    }
  })

  it('optConfirm 只接受布尔 true', () => {
    expect(optConfirm({ confirm: true })).toBe(true)
    expect(optConfirm({ confirm: 'true' })).toBe(false)
    expect(optConfirm({})).toBe(false)
  })
})
