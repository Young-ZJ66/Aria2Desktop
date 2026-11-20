import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Aria2Methods } from '@/types/aria2'

interface Call {
  method: string
  params: unknown[]
}

const h = vi.hoisted(() => ({
  calls: [] as Array<{ method: string, params: unknown[] }>,
  response: null as unknown,
  configs: [] as unknown[],
  events: [] as Array<{ kind: string, args: unknown[] }>
}))

vi.mock('./aria2Client', () => ({
  Aria2Client: class {
    constructor(config: unknown) {
      h.configs.push(config)
    }

    async connectWebSocket(): Promise<void> {
      h.events.push({ kind: 'connect', args: [] })
    }

    disconnect(): void {
      h.events.push({ kind: 'disconnect', args: [] })
    }

    isConnected(): boolean {
      return true
    }

    updateConfig(config: unknown): void {
      h.events.push({ kind: 'updateConfig', args: [config] })
    }

    on(event: string, listener: unknown): void {
      h.events.push({ kind: 'on', args: [event, listener] })
    }

    off(event: string, listener: unknown): void {
      h.events.push({ kind: 'off', args: [event, listener] })
    }

    async call(method: string, params: unknown[] = []): Promise<unknown> {
      h.calls.push({ method, params })
      return h.response
    }
  }
}))

async function loadService() {
  vi.resetModules()
  const { Aria2Service } = await import('./aria2Service')
  return new Aria2Service({ host: '127.0.0.1', port: 6800, protocol: 'http' })
}

function lastCall(): Call {
  return h.calls[h.calls.length - 1]
}

beforeEach(() => {
  h.calls.length = 0
  h.configs.length = 0
  h.events.length = 0
  h.response = 'gid-1'
})

describe('连接管理', () => {
  it('构造时把配置交给底层客户端', async () => {
    await loadService()
    expect(h.configs[0]).toEqual({ host: '127.0.0.1', port: 6800, protocol: 'http' })
  })

  it('connect / disconnect / isConnected / updateConfig 透传', async () => {
    const service = await loadService()
    await service.connect()
    expect(service.isConnected()).toBe(true)
    service.updateConfig({ port: 6801 })
    service.disconnect()
    expect(h.events.map((event) => event.kind)).toEqual(['connect', 'updateConfig', 'disconnect'])
  })

  it('on / off 把事件名与监听器原样转发', async () => {
    const service = await loadService()
    const listener = () => {}
    service.on('connected', listener)
    service.off('connected', listener)
    expect(h.events).toEqual([
      { kind: 'on', args: ['connected', listener] },
      { kind: 'off', args: ['connected', listener] }
    ])
  })
})

describe('添加任务', () => {
  it('addUri 传 URIs 与空选项对象（aria2 要求第二个位置参数存在）', async () => {
    const service = await loadService()
    await service.addUri(['https://example.com/a.bin'])
    expect(lastCall()).toEqual({
      method: Aria2Methods.ADD_URI,
      params: [['https://example.com/a.bin'], {}]
    })
  })

  it('addUri 带选项与位置时依次追加', async () => {
    const service = await loadService()
    await service.addUri(['https://example.com/a.bin'], { dir: '/data' }, 3)
    expect(lastCall().params).toEqual([['https://example.com/a.bin'], { dir: '/data' }, 3])
  })

  it('addUri 的空 URI 列表在本地就拒绝，不打 RPC', async () => {
    const service = await loadService()
    await expect(service.addUri([])).rejects.toThrow('URIs cannot be empty')
    expect(h.calls).toHaveLength(0)
  })

  it('addTorrent 缺省 uris 时用空数组占位，避免选项错位成 uris', async () => {
    const service = await loadService()
    await service.addTorrent('base64-torrent', undefined, { dir: '/data' })
    expect(lastCall().params).toEqual(['base64-torrent', [], { dir: '/data' }])
  })

  it('addTorrent 带 uris 与位置', async () => {
    const service = await loadService()
    await service.addTorrent('t', ['https://example.com/x'], { dir: '/d' }, 1)
    expect(lastCall().params).toEqual(['t', ['https://example.com/x'], { dir: '/d' }, 1])
  })

  it('addMetalink 透传内容与位置', async () => {
    h.response = ['gid-a']
    const service = await loadService()
    const gids = await service.addMetalink('metalink-xml', { dir: '/d' }, 2)
    expect(gids).toEqual(['gid-a'])
    expect(lastCall()).toEqual({ method: Aria2Methods.ADD_METALINK, params: ['metalink-xml', { dir: '/d' }, 2] })
  })
})

describe('任务控制', () => {
  it.each([
    ['remove', Aria2Methods.REMOVE],
    ['forceRemove', Aria2Methods.FORCE_REMOVE],
    ['pause', Aria2Methods.PAUSE],
    ['forcePause', Aria2Methods.FORCE_PAUSE],
    ['unpause', Aria2Methods.UNPAUSE]
  ] as const)('%s 只传 gid', async (method, expected) => {
    const service = await loadService()
    await (service[method] as (gid: string) => Promise<string>)('gid-9')
    expect(lastCall()).toEqual({ method: expected, params: ['gid-9'] })
  })

  it.each([
    ['pauseAll', Aria2Methods.PAUSE_ALL],
    ['forcePauseAll', Aria2Methods.FORCE_PAUSE_ALL],
    ['unpauseAll', Aria2Methods.UNPAUSE_ALL],
    ['purgeDownloadResult', Aria2Methods.PURGE_DOWNLOAD_RESULT],
    ['saveSession', Aria2Methods.SAVE_SESSION],
    ['shutdown', Aria2Methods.SHUTDOWN],
    ['forceShutdown', Aria2Methods.FORCE_SHUTDOWN]
  ] as const)('%s 不带参数', async (method, expected) => {
    const service = await loadService()
    await (service[method] as () => Promise<string>)()
    expect(lastCall()).toEqual({ method: expected, params: [] })
  })

  it('removeDownloadResult 只传 gid', async () => {
    const service = await loadService()
    await service.removeDownloadResult('gid-3')
    expect(lastCall()).toEqual({ method: Aria2Methods.REMOVE_DOWNLOAD_RESULT, params: ['gid-3'] })
  })

  it('changePosition 传 gid、位置与 how', async () => {
    h.response = 2
    const service = await loadService()
    const pos = await service.changePosition('gid-4', 1, 'POS_SET')
    expect(pos).toBe(2)
    expect(lastCall()).toEqual({ method: Aria2Methods.CHANGE_POSITION, params: ['gid-4', 1, 'POS_SET'] })
  })
})

describe('任务信息查询', () => {
  it('tellStatus 无 keys 时只传 gid', async () => {
    const service = await loadService()
    await service.tellStatus('gid-1')
    expect(lastCall()).toEqual({ method: Aria2Methods.TELL_STATUS, params: ['gid-1'] })
  })

  it('tellStatus 带 keys 时追加键列表', async () => {
    const service = await loadService()
    await service.tellStatus('gid-1', ['gid', 'status'])
    expect(lastCall().params).toEqual(['gid-1', ['gid', 'status']])
  })

  it('tellActive 无 keys 时参数为空数组', async () => {
    const service = await loadService()
    await service.tellActive()
    expect(lastCall()).toEqual({ method: Aria2Methods.TELL_ACTIVE, params: [] })
  })

  it('tellActive 带 keys 时只有一个参数', async () => {
    const service = await loadService()
    await service.tellActive(['gid'])
    expect(lastCall().params).toEqual([['gid']])
  })

  it('tellWaiting 传 offset 与 num', async () => {
    const service = await loadService()
    await service.tellWaiting(0, 100)
    expect(lastCall()).toEqual({ method: Aria2Methods.TELL_WAITING, params: [0, 100] })
  })

  it('tellStopped 不带 keys 时用默认精简键列表（避免拉全量字段）', async () => {
    const service = await loadService()
    await service.tellStopped(0, 20)
    const call = lastCall()
    expect(call.method).toBe(Aria2Methods.TELL_STOPPED)
    expect(call.params[0]).toBe(0)
    expect(call.params[1]).toBe(20)
    const keys = call.params[2] as string[]
    expect(keys).toContain('gid')
    expect(keys).toContain('status')
    expect(keys).toContain('verifiedLength')
    expect(keys).toContain('verifyIntegrityPending')
    // 精简键里不含 bittorrent（含 peer 列表，单任务可达数十 KB）
    expect(keys).not.toContain('bittorrent')
  })

  it('tellStopped 显式 keys 覆盖默认列表', async () => {
    const service = await loadService()
    await service.tellStopped(5, 10, ['gid'])
    expect(lastCall().params).toEqual([5, 10, ['gid']])
  })

  it.each([
    ['getFiles', Aria2Methods.GET_FILES],
    ['getUris', Aria2Methods.GET_URIS],
    ['getPeers', Aria2Methods.GET_PEERS],
    ['getServers', Aria2Methods.GET_SERVERS],
    ['getOption', Aria2Methods.GET_OPTION]
  ] as const)('%s 只传 gid', async (method, expected) => {
    h.response = []
    const service = await loadService()
    await (service[method] as (gid: string) => Promise<unknown>)('gid-7')
    expect(lastCall()).toEqual({ method: expected, params: ['gid-7'] })
  })
})

describe('选项与统计', () => {
  it('changeOption 传 gid 与选项对象', async () => {
    const service = await loadService()
    await service.changeOption('gid-1', { 'max-download-limit': '1M' })
    expect(lastCall()).toEqual({ method: Aria2Methods.CHANGE_OPTION, params: ['gid-1', { 'max-download-limit': '1M' }] })
  })

  it('getGlobalOption 不带参数', async () => {
    h.response = {}
    const service = await loadService()
    await service.getGlobalOption()
    expect(lastCall()).toEqual({ method: Aria2Methods.GET_GLOBAL_OPTION, params: [] })
  })

  it('changeGlobalOption 把选项对象作为唯一参数', async () => {
    const service = await loadService()
    await service.changeGlobalOption({ 'max-concurrent-downloads': '5' })
    expect(lastCall()).toEqual({ method: Aria2Methods.CHANGE_GLOBAL_OPTION, params: [{ 'max-concurrent-downloads': '5' }] })
  })

  it('getGlobalStat / getVersion 不带参数并透传返回值', async () => {
    h.response = { downloadSpeed: '0' }
    const service = await loadService()
    expect(await service.getGlobalStat()).toEqual({ downloadSpeed: '0' })
    expect(lastCall()).toEqual({ method: Aria2Methods.GET_GLOBAL_STAT, params: [] })
    await service.getVersion()
    expect(lastCall()).toEqual({ method: Aria2Methods.GET_VERSION, params: [] })
  })

  it('multicall 把调用列表包成单个数组参数', async () => {
    h.response = [['OK']]
    const service = await loadService()
    const calls = [{ methodName: 'aria2.pause', params: ['gid-1'] }]
    expect(await service.multicall(calls)).toEqual([['OK']])
    expect(lastCall()).toEqual({ method: Aria2Methods.MULTICALL, params: [calls] })
  })
})

describe('错误传播', () => {
  it('底层 RPC 拒绝时原样冒泡，不被吞掉', async () => {
    vi.resetModules()
    vi.doMock('./aria2Client', () => ({
      Aria2Client: class {
        async call(): Promise<unknown> {
          throw new Error('Aria2 RPC Error (1): Unauthorized')
        }
      }
    }))
    const { Aria2Service } = await import('./aria2Service')
    const service = new Aria2Service({ host: '127.0.0.1', port: 6800, protocol: 'http' })
    await expect(service.tellActive()).rejects.toThrow('Aria2 RPC Error (1): Unauthorized')
    vi.doUnmock('./aria2Client')
  })
})
