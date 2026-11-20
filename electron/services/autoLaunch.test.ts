import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const loginItem = { openAtLogin: false }
const getLoginItemSettings = vi.fn(() => loginItem)
const setLoginItemSettings = vi.fn()

vi.mock('electron', () => ({ app: { getLoginItemSettings, setLoginItemSettings } }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

const { getAutoLaunchEnabled, setAutoLaunchEnabled } = await import('./autoLaunch')

const originalPlatform = process.platform
const originalXdg = process.env.XDG_CONFIG_HOME
const originalAppImage = process.env.APPIMAGE
let configHome = ''

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function desktopFile(): string {
  return path.join(configHome, 'autostart', 'aria2-desktop.desktop')
}

beforeEach(() => {
  configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-autolaunch-'))
  process.env.XDG_CONFIG_HOME = configHome
  delete process.env.APPIMAGE
  loginItem.openAtLogin = false
  getLoginItemSettings.mockClear()
  setLoginItemSettings.mockClear()
})

afterEach(() => {
  setPlatform(originalPlatform)
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalXdg
  if (originalAppImage === undefined) delete process.env.APPIMAGE
  else process.env.APPIMAGE = originalAppImage
  fs.rmSync(configHome, { recursive: true, force: true })
})

describe('Linux 开机自启（XDG autostart）', () => {
  beforeEach(() => setPlatform('linux'))

  it('开启时写出符合 Desktop Entry 规范的自启项', () => {
    setAutoLaunchEnabled(true)
    const content = fs.readFileSync(desktopFile(), 'utf-8')
    expect(content).toContain('[Desktop Entry]')
    expect(content).toContain('Type=Application')
    expect(content).toContain('Name=Aria2 Desktop')
    expect(content).toContain('Terminal=false')
    expect(content).toContain('X-GNOME-Autostart-enabled=true')
    // Desktop Entry 规范要求 Exec 里的 " ` $ \ 加反斜杠转义（Windows 路径含反斜杠，故按同一规则算期望值）
    expect(content).toContain('Exec="' + process.execPath.replace(/(["`$\\])/g, '\\$1') + '"')
    expect(content.endsWith('\n')).toBe(true)
  })

  it('AppImage 下用 $APPIMAGE 而不是临时挂载点里的 execPath', () => {
    process.env.APPIMAGE = '/home/u/Apps/Aria2Desktop.AppImage'
    setAutoLaunchEnabled(true)
    const content = fs.readFileSync(desktopFile(), 'utf-8')
    expect(content).toContain('Exec="/home/u/Apps/Aria2Desktop.AppImage"')
    expect(content).not.toContain(process.execPath)
  })

  it('Exec 值里的引号与美元符号按规范转义', () => {
    process.env.APPIMAGE = '/opt/we"ird $HOME/app'
    setAutoLaunchEnabled(true)
    const content = fs.readFileSync(desktopFile(), 'utf-8')
    expect(content).toContain('Exec="' + process.env.APPIMAGE.replace(/(["`$\\])/g, '\\$1') + '"')
    expect(content).toContain('\\"')
    expect(content).toContain('\\$HOME')
  })

  it('关闭时删除自启项文件', () => {
    setAutoLaunchEnabled(true)
    expect(fs.existsSync(desktopFile())).toBe(true)
    setAutoLaunchEnabled(false)
    expect(fs.existsSync(desktopFile())).toBe(false)
  })

  it('关闭时文件本就不存在也不抛错', () => {
    expect(() => setAutoLaunchEnabled(false)).not.toThrow()
  })

  it('状态查询以文件是否存在为准', () => {
    expect(getAutoLaunchEnabled()).toBe(false)
    setAutoLaunchEnabled(true)
    expect(getAutoLaunchEnabled()).toBe(true)
  })
})

describe('Windows / macOS 开机自启（LoginItem）', () => {
  beforeEach(() => setPlatform('win32'))

  it('开启时写入登录项并带上可执行文件路径', () => {
    setAutoLaunchEnabled(true)
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: process.execPath })
  })

  it('关闭时把 openAtLogin 置 false', () => {
    setAutoLaunchEnabled(false)
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, path: process.execPath })
  })

  it('状态查询读登录项', () => {
    loginItem.openAtLogin = true
    expect(getAutoLaunchEnabled()).toBe(true)
    loginItem.openAtLogin = false
    expect(getAutoLaunchEnabled()).toBe(false)
  })

  it('读登录项失败时按未启用处理，不把异常抛给设置页', () => {
    getLoginItemSettings.mockImplementationOnce(() => {
      throw new Error('not supported')
    })
    expect(getAutoLaunchEnabled()).toBe(false)
  })
})
