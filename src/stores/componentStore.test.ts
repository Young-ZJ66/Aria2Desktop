import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 外部组件（yt-dlp / ffmpeg）状态。
 *
 * 两边页面共享同一份状态，几个容易漏的点：
 * 1) 检测只在第一次做，除非显式 force——否则每进一次页面就打一次主进程；
 * 2) 安装进行中再点安装必须直接返回失败，不能并发装两份（会互相覆盖目录）；
 * 3) 检测抛错按「未安装」处理，checked 仍要置 true，否则界面永远卡在「检测中」。
 */
vi.mock('@/composables/useMinimumLoading', () => ({
  withMinimumDuration: <T>(action: () => Promise<T>) => action()
}))

import { useComponentStore } from './componentStore'

type Api = Record<string, ReturnType<typeof vi.fn>>
let api: Api
let progressHandlers: { ytdlp?: (p: { percent?: number }) => void, ffmpeg?: (p: { percent?: number }) => void }

function installApi(): void {
  ;(globalThis as unknown as { window: unknown }).window = { electronAPI: api }
}

beforeEach(() => {
  setActivePinia(createPinia())
  progressHandlers = {}
  api = {
    ytdlpCheck: vi.fn(async () => ({ available: true, version: '2026.01.01', installable: true, approxSizeMB: 20 })),
    ffmpegCheck: vi.fn(async () => ({ available: false, installable: true, approxSizeMB: 80 })),
    ytdlpInstall: vi.fn(async () => ({ success: true, version: '2026.02.02' })),
    ffmpegInstall: vi.fn(async () => ({ success: true, version: '7.1' })),
    onYtdlpInstallProgress: vi.fn((handler: (p: { percent?: number }) => void) => { progressHandlers.ytdlp = handler; return () => {} }),
    onFfmpegInstallProgress: vi.fn((handler: (p: { percent?: number }) => void) => { progressHandlers.ffmpeg = handler; return () => {} })
  }
  installApi()
})

describe('checkYtdlp', () => {
  it('首次检测写入版本与大小，checked 置 true', async () => {
    const store = useComponentStore()
    await store.checkYtdlp()
    expect(store.ytdlp.available).toBe(true)
    expect(store.ytdlp.version).toBe('2026.01.01')
    expect(store.ytdlp.installable).toBe(true)
    expect(store.ytdlp.approxSizeMB).toBe(20)
    expect(store.ytdlp.checked).toBe(true)
    expect(store.ytdlp.checking).toBe(false)
  })

  it('已检测过不再重复请求，force 时重新请求', async () => {
    const store = useComponentStore()
    await store.checkYtdlp()
    await store.checkYtdlp()
    expect(api.ytdlpCheck).toHaveBeenCalledTimes(1)
    await store.checkYtdlp(true)
    expect(api.ytdlpCheck).toHaveBeenCalledTimes(2)
  })

  it('检测抛错按未安装处理，但 checked 仍置 true（否则界面永远卡在检测中）', async () => {
    api.ytdlpCheck.mockRejectedValue(new Error('spawn failed'))
    const store = useComponentStore()
    await store.checkYtdlp()
    expect(store.ytdlp.available).toBe(false)
    expect(store.ytdlp.checked).toBe(true)
    expect(store.ytdlp.checking).toBe(false)
  })

  it('主进程没有检测接口时直接标记已检测', async () => {
    ;(globalThis as unknown as { window: unknown }).window = {}
    const store = useComponentStore()
    await store.checkYtdlp()
    expect(store.ytdlp.checked).toBe(true)
  })
})

describe('checkFfmpeg', () => {
  it('缺字段时给出安全默认值', async () => {
    const store = useComponentStore()
    await store.checkFfmpeg()
    expect(store.ffmpeg.available).toBe(false)
    expect(store.ffmpeg.version).toBe('')
    expect(store.ffmpeg.installable).toBe(true)
    expect(store.ffmpeg.approxSizeMB).toBe(80)
  })
})

describe('安装', () => {
  it('安装成功后重新检测并更新版本', async () => {
    const store = useComponentStore()
    const result = await store.installYtdlp()
    expect(result.success).toBe(true)
    expect(api.ytdlpCheck).toHaveBeenCalledTimes(1)
    expect(store.ytdlp.installing).toBe(false)
    expect(store.ytdlp.installPercent).toBe(0)
  })

  it('安装中再次点击直接返回失败（不能并发装两份）', async () => {
    let release: (value: unknown) => void = () => {}
    api.ytdlpInstall.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const store = useComponentStore()
    const first = store.installYtdlp()
    const second = await store.installYtdlp()
    expect(second).toEqual({ success: false, error: 'Not available' })
    release({ success: true, version: 'x' })
    await first
  })

  it('安装抛错归一成失败结果并复位安装态', async () => {
    api.ffmpegInstall.mockRejectedValue(new Error('checksum mismatch'))
    const store = useComponentStore()
    await expect(store.installFfmpeg()).resolves.toEqual({ success: false, error: 'checksum mismatch' })
    expect(store.ffmpeg.installing).toBe(false)
  })

  it('安装进度事件写入 installPercent，且只订阅一次', async () => {
    const store = useComponentStore()
    await store.installYtdlp()
    await store.installYtdlp()
    expect(api.onYtdlpInstallProgress).toHaveBeenCalledTimes(1)
    progressHandlers.ytdlp?.({ percent: 42 })
    expect(store.ytdlp.installPercent).toBe(42)
    progressHandlers.ytdlp?.({})
    expect(store.ytdlp.installPercent).toBe(0)
  })
})

describe('组件检测与安装的补充边界', () => {
  it('检测进行中再次调用不会重复打主进程', async () => {
    let release: (value: unknown) => void = () => {}
    api.ytdlpCheck.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const store = useComponentStore()
    const first = store.checkYtdlp()
    await store.checkYtdlp()
    expect(api.ytdlpCheck).toHaveBeenCalledTimes(1)
    release({ available: true, version: 'v', installable: true, approxSizeMB: 1 })
    await first
  })

  it('ffmpeg 检测抛错同样按未安装处理且 checked 置 true', async () => {
    api.ffmpegCheck.mockRejectedValue(new Error('spawn failed'))
    const store = useComponentStore()
    await store.checkFfmpeg()
    expect(store.ffmpeg.available).toBe(false)
    expect(store.ffmpeg.checked).toBe(true)
    expect(store.ffmpeg.checking).toBe(false)
  })

  it('ffmpeg 安装进度事件写入 installPercent 且只订阅一次', async () => {
    const store = useComponentStore()
    await store.installFfmpeg()
    await store.installFfmpeg()
    expect(api.onFfmpegInstallProgress).toHaveBeenCalledTimes(1)
    progressHandlers.ffmpeg?.({ percent: 66 })
    expect(store.ffmpeg.installPercent).toBe(66)
    progressHandlers.ffmpeg?.({})
    expect(store.ffmpeg.installPercent).toBe(0)
  })

  it('ffmpeg 安装成功后重新检测', async () => {
    const store = useComponentStore()
    const result = await store.installFfmpeg()
    expect(result).toEqual({ success: true, version: '7.1' })
    expect(api.ffmpegCheck).toHaveBeenCalledTimes(1)
  })

  it('ffmpeg 安装中再次点击直接返回失败', async () => {
    let release: (value: unknown) => void = () => {}
    api.ffmpegInstall.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const store = useComponentStore()
    const first = store.installFfmpeg()
    const second = await store.installFfmpeg()
    expect(second).toEqual({ success: false, error: 'Not available' })
    release({ success: true, version: 'x' })
    await first
  })

  it('主进程没有安装接口时返回 Not available 且不进入安装态', async () => {
    ;(globalThis as unknown as { window: unknown }).window = {
      electronAPI: { ytdlpCheck: api.ytdlpCheck, ffmpegCheck: api.ffmpegCheck }
    }
    const store = useComponentStore()
    await expect(store.installYtdlp()).resolves.toEqual({ success: false, error: 'Not available' })
    await expect(store.installFfmpeg()).resolves.toEqual({ success: false, error: 'Not available' })
    expect(store.ytdlp.installing).toBe(false)
    expect(store.ffmpeg.installing).toBe(false)
  })
})
