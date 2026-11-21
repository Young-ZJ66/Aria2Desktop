import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * yt-dlp 服务的失败路径测试（可执行文件解析、安装收尾、spawn 报错）。
 *
 * 与 ytdlpService.test.ts 分工：那个文件只测 mapPlaylistEntries 纯函数；
 * 这里把网络/下载/校验/spawn 全部换成脚本，覆盖「安装成功但自检失败」「旧版本恢复失败」
 * 「spawn 非 ENOENT 错误」这类只在异常现场才走到的分支。
 */

const h = vi.hoisted(() => {
  const state = {
    userData: '',
    asset: { executable: 'yt-dlp', fileName: 'yt-dlp', approxSizeMB: 20 } as any,
    expected: 'a'.repeat(64),
    actual: 'a'.repeat(64),
    sums: '',
    spawnPlan: [] as any[],
    spawnCalls: [] as any[],
    chmodCalls: [] as any[],
    restoreThrows: false,
    downloadCalls: [] as any[],
    logs: { info: [] as any[], warn: [] as any[], error: [] as any[] }
  }
  return { state }
})

const { state } = h

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => state.userData, getName: () => 'test' }
}))

vi.mock('electron-log/main', () => ({
  default: {
    debug: (message: unknown) => state.logs.info.push(message),
    info: (message: unknown) => state.logs.info.push(message),
    warn: (message: unknown) => state.logs.warn.push(message),
    error: (message: unknown) => state.logs.error.push(message),
    transports: { file: {}, console: {} }
  }
}))

vi.mock('../utils/appEnv', () => ({ isPackagedApp: false }))
vi.mock('../utils/ytdlpAssets', () => ({ resolveYtdlpAsset: () => state.asset }))
vi.mock('../utils/sha256Sums', () => ({ findSha256ForFile: () => state.expected }))
vi.mock('../utils/fileHash', () => ({ computeFileSha256: async () => state.actual }))
vi.mock('../utils/componentUpdate', () => ({ isNewerVersion: (a: string, b: string) => a !== b }))
vi.mock('../utils/mainErrorCopy', () => ({ mainError: (_locale: string, key: string) => 'zh:' + key }))
vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))

vi.mock('../utils/downloader', () => ({
  fetchText: async () => state.sums,
  downloadToFile: async (url: string, dest: string) => {
    state.downloadCalls.push({ url, dest })
    fs.writeFileSync(dest, 'fake-binary', 'utf8')
  }
}))

vi.mock('child_process', () => ({
  spawn: vi.fn((file: string, args: string[]) => {
    state.spawnCalls.push({ file, args })
    const proc = new EventEmitter() as any
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    const plan = state.spawnPlan.shift() ?? { code: 0, stdout: '' }
    setImmediate(() => {
      if (plan.stdout) proc.stdout.emit('data', Buffer.from(plan.stdout, 'utf8'))
      if (plan.stderr) proc.stderr.emit('data', Buffer.from(plan.stderr, 'utf8'))
      if (plan.error) proc.emit('error', plan.error)
      else proc.emit('exit', plan.code ?? 0)
    })
    return proc
  })
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    default: actual,
    chmodSync: (...args: any[]) => {
      state.chmodCalls.push(args)
      return undefined
    },
    renameSync: (...args: any[]) => {
      if (state.restoreThrows && String(args[0]).endsWith('.bak')) {
        throw new Error('EPERM: restore blocked')
      }
      return (actual.renameSync as any)(...args)
    }
  }
})

let tmpDir = ''

async function loadService() {
  vi.resetModules()
  return import('./ytdlpService')
}

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-coverage-'))
  state.userData = tmpDir
  state.asset = { executable: 'yt-dlp', fileName: 'yt-dlp', approxSizeMB: 20 }
  state.expected = 'a'.repeat(64)
  state.actual = 'a'.repeat(64)
  state.sums = 'yt-dlp: ' + 'a'.repeat(64)
  state.spawnPlan.length = 0
  state.spawnCalls.length = 0
  state.chmodCalls.length = 0
  state.restoreThrows = false
  state.downloadCalls.length = 0
  state.logs.info.length = 0
  state.logs.warn.length = 0
  state.logs.error.length = 0
})

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('可执行文件解析与安装收尾', () => {
  it('应用内已下载过时优先使用下载版路径', async () => {
    setPlatform('linux')
    state.asset = { executable: 'yt-dlp-linux', fileName: 'yt-dlp', approxSizeMB: 20 }
    const dir = path.join(tmpDir, 'yt-dlp')
    fs.mkdirSync(dir, { recursive: true })
    const downloaded = path.join(dir, 'yt-dlp-linux')
    fs.writeFileSync(downloaded, 'x', 'utf8')

    const service = await loadService()
    expect(service.getYtdlpExecutablePath()).toBe(downloaded)
  })

  it('非 Windows 平台安装成功后补上执行位', async () => {
    setPlatform('linux')
    state.spawnPlan.push({ code: 0, stdout: '2024.10.22\n' })

    const service = await loadService()
    const result = await service.installYtdlp()

    expect(result).toEqual({ success: true, version: '2024.10.22' })
    expect(state.chmodCalls).toHaveLength(1)
    expect(state.chmodCalls[0][1]).toBe(0o755)
    // 回归守卫：安装包本体必须真的落到目标路径（曾被原子替换前的多余 rm 删掉，rename 必然 ENOENT）
    const target = path.join(tmpDir, 'yt-dlp', 'yt-dlp')
    expect(fs.readFileSync(target, 'utf8')).toBe('fake-binary')
    expect(fs.existsSync(path.join(tmpDir, 'yt-dlp', 'yt-dlp.download'))).toBe(false)
  })

  it('自检失败且旧版本恢复也失败时只记日志并返回失败', async () => {
    setPlatform('win32')
    const dir = path.join(tmpDir, 'yt-dlp')
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, 'yt-dlp.exe')
    fs.writeFileSync(target, 'old-binary', 'utf8')
    state.asset = { executable: 'yt-dlp.exe', fileName: 'yt-dlp.exe', approxSizeMB: 20 }
    state.restoreThrows = true
    // 安装后的 --version 自检失败：触发 catch 里的旧版本恢复分支
    state.spawnPlan.push({ code: 1, stderr: 'glibc too old' })

    const service = await loadService()
    const result = await service.installYtdlp()

    expect(result.success).toBe(false)
    expect(result.error).toContain('glibc too old')
    expect(state.logs.warn.some((line) => String(line).includes('yt-dlp 旧版本恢复失败'))).toBe(true)
  })
})

describe('调用 yt-dlp 时的失败路径', () => {
  it('getFormatUrl 拒绝非 http 地址', async () => {
    const service = await loadService()
    const result = await service.getFormatUrl('ftp://example.com/v', '137')
    expect(result).toEqual({ success: false, error: 'Invalid URL' })
    expect(state.spawnCalls).toHaveLength(0)
  })

  it('spawn 报非 ENOENT 错误时原样透出（不伪装成未安装）', async () => {
    state.spawnPlan.push({ error: new Error('spawn ECONNRESET') })
    const service = await loadService()
    const result = await service.getFormatUrl('https://example.com/v', '137')
    expect(result.success).toBe(false)
    expect(result.error).toBe('spawn ECONNRESET')
  })

  it('播放列表解析失败时把 stderr 带回渲染层', async () => {
    state.spawnPlan.push({ code: 1, stderr: 'ERROR: playlist not found' })
    const service = await loadService()
    const result = await service.getPlaylistInfo('https://example.com/list')
    expect(result).toEqual({ success: false, error: 'ERROR: playlist not found' })
  })
})
