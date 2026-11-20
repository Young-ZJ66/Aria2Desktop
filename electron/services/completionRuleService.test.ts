import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// completionRuleService 顶层 import electron 与 RPC/解压/Webhook 依赖。
// 这里只测「归一化任务 → 规则匹配/执行」这一段，因此把副作用全部桩掉：
// 真正的 aria2 tellStatus 路径由 applyCompletionRules 承担，不在本文件覆盖范围。
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getLocale: () => 'en-US' },
  Notification: class {
    static isSupported(): boolean { return false }
  },
  shell: { openPath: vi.fn(async () => '') }
}))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), transports: { file: {}, console: {} } }
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn(async () => ({})) }))
vi.mock('../utils/activeRpcConfig', () => ({ activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800, protocol: 'http', path: '/jsonrpc', secret: '' }) }))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: vi.fn(() => ({})) }))
vi.mock('./archiveService', () => ({ extractArchive: vi.fn(async () => ({ success: true })) }))
const enqueueMock = vi.fn()
vi.mock('./webhookDispatchService', () => ({ getWebhookDispatchService: () => ({ enqueue: enqueueMock }) }))

const { applyCompletionRulesForTask } = await import('./completionRuleService')
const { getSettingsFresh } = await import('../utils/settingsAccessor')

function setRules(rules: unknown[]): void {
  vi.mocked(getSettingsFresh).mockReturnValue({ completionRules: rules } as never)
}

describe('applyCompletionRulesForTask（流媒体任务共用完成规则，D-10）', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-rule-'))
  })

  it('没有配置规则时直接返回 false', async () => {
    setRules([])
    const matched = await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [] })
    expect(matched).toBe(false)
  })

  it('move 动作把流媒体产物移动到目标目录', async () => {
    const source = path.join(tmpDir, 'video.mp4')
    fs.writeFileSync(source, 'x')
    const target = path.join(tmpDir, 'done')
    setRules([{ id: 'r1', name: 'move-video', enabled: true, actions: [{ type: 'move', targetDir: target }] }])

    const matched = await applyCompletionRulesForTask({
      status: 'complete',
      dir: tmpDir,
      files: [source],
      name: 'video'
    })

    expect(matched).toBe(true)
    expect(fs.existsSync(path.join(target, 'video.mp4'))).toBe(true)
    expect(fs.existsSync(source)).toBe(false)
  })

  it('condition.status = error 的规则不会在成功任务上触发', async () => {
    setRules([{
      id: 'r2',
      name: 'only-error',
      enabled: true,
      condition: { status: 'error' },
      actions: [{ type: 'webhook', url: 'https://example.com/hook' }]
    }])

    const matched = await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [] })

    expect(matched).toBe(false)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('失败任务命中 error 规则时投递 webhook，载荷带错误与任务名', async () => {
    setRules([{
      id: 'r3',
      name: 'notify-error',
      enabled: true,
      condition: { status: 'error' },
      actions: [{ type: 'webhook', url: 'https://example.com/hook' }]
    }])

    const matched = await applyCompletionRulesForTask({
      status: 'error',
      dir: tmpDir,
      files: [],
      name: '某视频',
      errorMessage: 'yt-dlp exited with code 1'
    })

    expect(matched).toBe(true)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [action, payload] = enqueueMock.mock.calls[0]!
    expect(action.url).toBe('https://example.com/hook')
    expect(payload).toMatchObject({
      event: 'download.error',
      status: 'error',
      name: '某视频',
      dir: tmpDir
    })
  })

  it('扩展名条件按实际产物匹配（播放列表多文件）', async () => {
    setRules([{
      id: 'r4',
      name: 'only-mp3',
      enabled: true,
      condition: { extensions: ['mp3'] },
      actions: [{ type: 'webhook', url: 'https://example.com/hook' }]
    }])

    const noMatch = await applyCompletionRulesForTask({
      status: 'complete',
      dir: tmpDir,
      files: [path.join(tmpDir, 'a.mp4')]
    })
    expect(noMatch).toBe(false)

    const matched = await applyCompletionRulesForTask({
      status: 'complete',
      dir: tmpDir,
      files: [path.join(tmpDir, 'a.mp4'), path.join(tmpDir, 'b.mp3')]
    })
    expect(matched).toBe(true)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('禁用的规则不执行', async () => {
    setRules([{
      id: 'r5',
      name: 'disabled',
      enabled: false,
      actions: [{ type: 'webhook', url: 'https://example.com/hook' }]
    }])

    const matched = await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [] })
    expect(matched).toBe(false)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
