/**
 * 打包产物冒烟的产物定位逻辑。
 *
 * 为什么要测：冒烟脚本本身不该成为静默失败源。三个平台对免安装目录各有各的命名，
 * 而这类问题只有 CI 真正跑到那一刻才会暴露——那时已经被判失败了。这里用临时目录
 * 构造三种布局，把推断逻辑钉死；Windows 开发机也能跑（Linux 分支的执行位判定可替换）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkFreshDefaults,
  checkRendererRendered,
  isRendererHealthy,
  readOptions,
  resolveDefaultExe,
  resolveLinuxExecutable,
  resolveMacExecutable,
  resolveWindowsExecutable
} from './smoke-packaged.mjs'

const LINUX_MIN_BYTES = 10 * 1024 * 1024

let releaseDir

/** 造一个体积达标（稀疏文件，不真占磁盘）的可执行文件 */
function makeExecutable(file, { size = LINUX_MIN_BYTES + 1 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '')
  fs.truncateSync(file, size)
  return file
}

beforeEach(() => {
  releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-resolve-'))
})

afterEach(() => {
  fs.rmSync(releaseDir, { recursive: true, force: true })
})

describe('resolveWindowsExecutable', () => {
  it('只有 x64 免安装目录时用它', () => {
    const exe = makeExecutable(path.join(releaseDir, 'win-unpacked', 'Aria2Desktop.exe'))
    expect(resolveWindowsExecutable(releaseDir)).toBe(exe)
  })

  it('同时存在两个架构时优先 x64', () => {
    makeExecutable(path.join(releaseDir, 'win-ia32-unpacked', 'Aria2Desktop.exe'))
    const x64 = makeExecutable(path.join(releaseDir, 'win-unpacked', 'Aria2Desktop.exe'))
    expect(resolveWindowsExecutable(releaseDir)).toBe(x64)
  })

  it('只有 32 位目录时用它', () => {
    const ia32 = makeExecutable(path.join(releaseDir, 'win-ia32-unpacked', 'Aria2Desktop.exe'))
    expect(resolveWindowsExecutable(releaseDir)).toBe(ia32)
  })

  it('都没有时给出默认路径（由调用方报错，不在这里抛）', () => {
    expect(resolveWindowsExecutable(releaseDir)).toBe(
      path.join(releaseDir, 'win-unpacked', 'Aria2Desktop.exe')
    )
  })
})

describe('resolveMacExecutable', () => {
  it('从 .app 包里取可执行文件', () => {
    const exe = makeExecutable(
      path.join(releaseDir, 'mac-arm64', 'Aria2Desktop.app', 'Contents', 'MacOS', 'Aria2Desktop')
    )
    expect(resolveMacExecutable(releaseDir)).toBe(exe)
  })

  it('x64 与 arm64 同时存在时优先 arm64', () => {
    makeExecutable(path.join(releaseDir, 'mac', 'Aria2Desktop.app', 'Contents', 'MacOS', 'Aria2Desktop'))
    const arm = makeExecutable(
      path.join(releaseDir, 'mac-arm64', 'Aria2Desktop.app', 'Contents', 'MacOS', 'Aria2Desktop')
    )
    expect(resolveMacExecutable(releaseDir)).toBe(arm)
  })

  it('目录缺失时给出默认路径', () => {
    expect(resolveMacExecutable(releaseDir)).toBe(
      path.join(releaseDir, 'mac-arm64', 'Aria2Desktop.app', 'Contents', 'MacOS', 'Aria2Desktop')
    )
  })
})

describe('resolveLinuxExecutable', () => {
  it('按体积认出主可执行文件，跳过 chrome-sandbox 与 crashpad', () => {
    makeExecutable(path.join(releaseDir, 'linux-unpacked', 'chrome-sandbox'), { size: 15 * 1024 })
    makeExecutable(path.join(releaseDir, 'linux-unpacked', 'chrome_crashpad_handler'), {
      size: 1024 * 1024
    })
    const main = makeExecutable(path.join(releaseDir, 'linux-unpacked', 'aria2-desktop'))
    expect(resolveLinuxExecutable(releaseDir, () => true)).toBe(main)
  })

  it('候选文件都没有执行位时退回默认名', () => {
    makeExecutable(path.join(releaseDir, 'linux-unpacked', 'aria2-desktop'))
    expect(resolveLinuxExecutable(releaseDir, () => false)).toBe(
      path.join(releaseDir, 'linux-unpacked', 'aria2-desktop')
    )
  })

  it('目录不存在时给出默认路径', () => {
    expect(resolveLinuxExecutable(releaseDir)).toBe(path.join(releaseDir, 'linux-unpacked', 'aria2-desktop'))
  })
})

describe('resolveDefaultExe', () => {
  it('按当前平台挑对应目录，而不是写死某个平台', () => {
    const win = makeExecutable(path.join(releaseDir, 'win-unpacked', 'Aria2Desktop.exe'))
    const mac = makeExecutable(
      path.join(releaseDir, 'mac-arm64', 'Aria2Desktop.app', 'Contents', 'MacOS', 'Aria2Desktop')
    )
    const linux = makeExecutable(path.join(releaseDir, 'linux-unpacked', 'aria2-desktop'))
    const expected = process.platform === 'darwin' ? mac : process.platform === 'linux' ? linux : win
    expect(resolveDefaultExe(releaseDir)).toBe(expected)
  })
})

describe('readOptions', () => {
  it('解析 --exe / --timeout / --retries / --keep / --spawn-args（两种写法都认）', () => {
    const exe = makeExecutable(path.join(releaseDir, 'any.exe'), { size: 1024 })
    const options = readOptions([
      '--exe',
      exe,
      '--timeout',
      '120000',
      '--retries',
      '0',
      '--keep',
      '--spawn-args=--no-sandbox --disable-gpu'
    ])
    expect(options.exePath).toBe(path.resolve(exe))
    expect(options.timeoutMs).toBe(120000)
    expect(options.retries).toBe(0)
    expect(options.keepData).toBe(true)
    expect(options.spawnArgs).toEqual(['--no-sandbox', '--disable-gpu'])
  })

  it('缺省值：超时 90s、重试 1 次、不留现场、无额外启动参数', () => {
    const exe = makeExecutable(path.join(releaseDir, 'any.exe'), { size: 1024 })
    const options = readOptions(['--exe', exe])
    expect(options.timeoutMs).toBe(90000)
    expect(options.retries).toBe(1)
    expect(options.keepData).toBe(false)
    expect(options.spawnArgs).toEqual([])
  })
})

describe('checkFreshDefaults', () => {
  it('空白目录里没有配置时两条都失败', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-fresh-'))
    const results = checkFreshDefaults(dir)
    expect(results.map((r) => r.ok)).toEqual([false, false])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('应用自己生出设置文件与 aria2.conf 时通过', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-fresh-'))
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'aria2'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'config', 'aria2-desktop-settings.json'), '{}')
    fs.writeFileSync(
      path.join(dir, 'aria2', 'aria2.conf'),
      'dir=D:/Downloads\nsave-session=D:/x/aria2.session\ninput-file=D:/x/aria2.session\n'
    )
    const results = checkFreshDefaults(dir)
    expect(results.map((r) => r.ok)).toEqual([true, true])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('isRendererHealthy', () => {
  it('正常渲染的页面算健康', () => {
    expect(
      isRendererHealthy({
        title: 'Aria2 Desktop',
        text: '正在下载  已停止  已完成\nAria2  下载任务 (0)',
        url: 'file:///E:/app/dist/vue/index.html#/downloading'
      })
    ).toBe(true)
  })

  it('白屏（正文为空）判为不健康', () => {
    expect(isRendererHealthy({ title: 'Aria2 Desktop', text: '   ', url: 'file:///x/index.html' })).toBe(false)
  })

  it('加载失败页（ERR_FILE_NOT_FOUND）判为不健康', () => {
    expect(
      isRendererHealthy({
        title: 'Aria2 Desktop',
        text: 'ERR_FILE_NOT_FOUND\nfile:///x/dist/vue/index.html',
        url: 'file:///x/index.html'
      })
    ).toBe(false)
  })

  it('Chromium 错误页判为不健康', () => {
    expect(
      isRendererHealthy({
        title: 'Aria2 Desktop',
        text: '这里有一整段正常内容，长度超过二十个字符。',
        url: 'chrome-error://chromewebdata/'
      })
    ).toBe(false)
  })

  it('没有标题或内容太短判为不健康', () => {
    expect(isRendererHealthy({ title: '', text: '这里有一整段正常内容，长度超过二十个字符。' })).toBe(false)
    expect(isRendererHealthy({ title: 'Aria2 Desktop', text: '加载中' })).toBe(false)
  })
})

describe('checkRendererRendered', () => {
  it('调试端口连不上时判为失败而不是崩掉', async () => {
    // 端口 1 上不会有调试目标：脚本应当报"没有暴露调试目标"，而不是抛异常
    const result = await checkRendererRendered(1, 600)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('没有暴露调试目标')
  }, 15000)
})
