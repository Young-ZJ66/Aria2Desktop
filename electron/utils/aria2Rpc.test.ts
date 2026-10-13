import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Aria2RpcError, callAria2Rpc, classifyRpcPortProbe } from './aria2Rpc'

/**
 * aria2 RPC 是所有主进程服务（密钥轮换、会话保存、限速、插件 API）的公共出口，
 * 这里用本地假 RPC 服务锁死：token 前置规则、RPC 级错误与传输级错误的区分、非 JSON-RPC 响应拒绝、超时。
 */
const servers: Server[] = []

/** 起一个本地假 RPC 服务；respond 返回 null 表示"永不响应"（用于超时用例） */
async function startFakeRpc(
  respond: (body: string) => { status?: number; body: string } | null
): Promise<{ port: number; received: string[] }> {
  const received: string[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      received.push(raw)
      const result = respond(raw)
      if (!result) return // 故意不响应
      res.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' })
      res.end(result.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  servers.push(server)
  const address = server.address()
  return { port: typeof address === 'object' && address ? address.port : 0, received }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
})

describe('callAria2Rpc', () => {
  it('成功时返回 result 字段', async () => {
    const { port } = await startFakeRpc(() => ({
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', result: { version: '1.37.0' } })
    }))
    await expect(callAria2Rpc({ port, method: 'aria2.getVersion' }))
      .resolves.toEqual({ version: '1.37.0' })
  })

  it('无密钥时 params 不含 token', async () => {
    const { port, received } = await startFakeRpc(() => ({
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'ok' })
    }))
    await callAria2Rpc({ port, method: 'aria2.getVersion', params: ['x'] })
    const sent = JSON.parse(received[0] ?? '{}')
    expect(sent.params).toEqual(['x'])
  })

  it('有密钥时 token 前置到 params 首位', async () => {
    const { port, received } = await startFakeRpc(() => ({
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'ok' })
    }))
    await callAria2Rpc({ port, secret: 'abc123', method: 'aria2.getVersion', params: ['x'] })
    const sent = JSON.parse(received[0] ?? '{}')
    expect(sent.params).toEqual(['token:abc123', 'x'])
    expect(sent.method).toBe('aria2.getVersion')
  })

  it('RPC 返回 error 时抛 Aria2RpcError（可据此判断"协议层已就绪"）', async () => {
    const { port } = await startFakeRpc(() => ({
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', error: { code: 1, message: 'Unauthorized' } })
    }))
    await expect(callAria2Rpc({ port, method: 'aria2.getVersion' }))
      .rejects.toBeInstanceOf(Aria2RpcError)
  })

  it('非 JSON-RPC 响应（如端口被其它服务占用返回 HTML）时拒绝', async () => {
    const { port } = await startFakeRpc(() => ({ body: '<html>not jsonrpc</html>' }))
    await expect(callAria2Rpc({ port, method: 'aria2.getVersion' }))
      .rejects.toThrow('Invalid JSON-RPC response')
  })

  it('HTTP 非 2xx 但响应体是 JSON-RPC 时仍按协议处理（不额外判状态码）', async () => {
    const { port } = await startFakeRpc(() => ({
      status: 500,
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'ok' })
    }))
    await expect(callAria2Rpc({ port, method: 'aria2.getVersion' })).resolves.toBe('ok')
  })

  it('超时（服务不响应）时拒绝', async () => {
    const { port } = await startFakeRpc(() => null)
    await expect(callAria2Rpc({ port, method: 'aria2.getVersion', timeoutMs: 300 }))
      .rejects.toThrow(/timeout/i)
  })

  it('端口无服务监听时拒绝（连接被拒）', async () => {
    const { port } = await startFakeRpc(() => null)
    await new Promise<void>((resolve) => {
      const s = servers.pop()
      s?.close(() => resolve())
    })
    await expect(callAria2Rpc({ port, method: 'aria2.getVersion', timeoutMs: 500 })).rejects.toThrow()
  })
})

/**
 * 启动前端口占用分类：决定"RPC 端口上已经有别的引擎"这句告警能不能说清原因。
 * 它面对的是各种奇形怪状的错误，所以把每种输入钉死，并额外验证与实际抛出的错误对得上。
 */
describe('classifyRpcPortProbe（启动前端口占用分类）', () => {
  it('探测成功（无错误）→ 有 aria2 且在认我们的密钥', () => {
    expect(classifyRpcPortProbe(null)).toBe('aria2-with-our-secret')
    expect(classifyRpcPortProbe(undefined)).toBe('aria2-with-our-secret')
  })

  it('密钥不匹配 → 外来引擎（09-30 那类 Unauthorized 的真正来源）', () => {
    expect(classifyRpcPortProbe(new Aria2RpcError('Aria2 RPC Error: Unauthorized')))
      .toBe('aria2-with-other-secret')
    expect(classifyRpcPortProbe(new Error('Aria2 RPC Error: unauthorized.')))
      .toBe('aria2-with-other-secret') // 大小写/句点变化不影响判定
  })

  it('其它协议层错误 → 仍是"认我们密钥的 aria2"（它只是嫌参数不对）', () => {
    expect(classifyRpcPortProbe(new Aria2RpcError('Aria2 RPC Error: Invalid params.')))
      .toBe('aria2-with-our-secret')
  })

  it('端口有服务但不是 aria2 → 被别的程序占用', () => {
    expect(classifyRpcPortProbe(new Error('Invalid JSON-RPC response'))).toBe('non-aria2-service')
  })

  it('连接被拒 → 端口空闲（正常启动路径，不该告警）', () => {
    expect(classifyRpcPortProbe(new Error('connect ECONNREFUSED 127.0.0.1:6800'))).toBe('free')
    expect(classifyRpcPortProbe(new Error('read ECONNRESET'))).toBe('free')
  })

  it('超时等无法归类的错误 → unknown（调用方只记 info，不下结论）', () => {
    expect(classifyRpcPortProbe(new Error('Aria2 RPC request timeout'))).toBe('unknown')
    expect(classifyRpcPortProbe('some string error')).toBe('unknown')
  })

  it('与实际 callAria2Rpc 抛出的错误一一对得上（错误文案变更时这里会红）', async () => {
    // 1) 对端返回 Unauthorized → 外来引擎
    const wrongSecret = await startFakeRpc(() => ({
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', error: { code: 1, message: 'Unauthorized' } })
    }))
    const err1 = await callAria2Rpc({ port: wrongSecret.port, method: 'aria2.getVersion' }).catch((e) => e)
    expect(classifyRpcPortProbe(err1)).toBe('aria2-with-other-secret')

    // 2) 端口上不是 aria2（返回 HTML） → 被别的程序占用
    const notAria2 = await startFakeRpc(() => ({ body: '<html>hello</html>' }))
    const err2 = await callAria2Rpc({ port: notAria2.port, method: 'aria2.getVersion' }).catch((e) => e)
    expect(classifyRpcPortProbe(err2)).toBe('non-aria2-service')

    // 3) 有服务但不响应（超时） → 不下结论
    const silent = await startFakeRpc(() => null)
    const err3 = await callAria2Rpc({ port: silent.port, method: 'aria2.getVersion', timeoutMs: 300 }).catch((e) => e)
    expect(classifyRpcPortProbe(err3)).toBe('unknown')

    // 4) 无服务监听 → 端口空闲
    const closed = await startFakeRpc(() => null)
    await new Promise<void>((resolve) => {
      const s = servers.pop()
      s?.close(() => resolve())
    })
    const err4 = await callAria2Rpc({ port: closed.port, method: 'aria2.getVersion', timeoutMs: 500 }).catch((e) => e)
    expect(classifyRpcPortProbe(err4)).toBe('free')
  })
})
