import { describe, expect, it } from 'vitest'
import {
  MCP_PROTOCOL_VERSION,
  MCP_ERROR_CODES,
  buildInitializeResult,
  buildToolErrorResult,
  buildToolTextResult,
  buildToolsListResult,
  isNotification,
  mcpError,
  mcpResult,
  optNumber,
  optString,
  parseToolCallParams
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
      capabilities: { tools: unknown }
      serverInfo: { name: string; version: string }
    }
    expect(r.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(r.capabilities.tools).toEqual({})
    expect(r.serverInfo).toEqual({ name: 'aria2-desktop', version: '1.2.3' })
  })
})

describe('buildToolsListResult', () => {
  it('工具清单含 5 个核心工具且 inputSchema 合法', () => {
    const r = buildToolsListResult() as { tools: Array<{ name: string; inputSchema: { type: string } }> }
    expect(r.tools.map(t => t.name)).toEqual([
      'add_download',
      'list_tasks',
      'get_download_status',
      'pause_task',
      'resume_task'
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
