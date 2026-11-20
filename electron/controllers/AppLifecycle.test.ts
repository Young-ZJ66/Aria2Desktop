/**
 * AppLifecycle 的单元测试。
 *
 * 覆盖三处曾经出过问题、且都只能靠集成才能发现的行为：
 * - D-12：--headless 不建窗口；建窗失败（无 DISPLAY）不致命；
 * - D-20：引擎启动失败按分类给出可点的下一步（而不是笼统的继续/退出）；
 * - D-21：引擎放弃自动重启必须发系统通知（托盘/无头模式下唯一的触达方式）。
 *
 * 依赖全部打桩：本测试不加载任何真实的 electron / 子进程模块。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  notificationShow: vi.fn(),
  openPath: vi.fn(async (_dir: string) => ''),
  logFilePaths: vi.fn(() => ({ file: 'C:/logs/app.log', dir: 'C:/logs' }))
}))

vi.mock('electron', () => ({
  dialog: { showMessageBox: (...args: unknown[]) => mocks.showMessageBox(...args) },
  shell: { openPath: (dir: string) => mocks.openPath(dir) },
  Notification: class {
    static isSupported(): boolean {
      return true
    }
    constructor(public options: unknown) {}
    show(): void {
      mocks.notificationShow(this.options)
    }
  }
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  getLogFilePaths: () => mocks.logFilePaths()
}))

vi.mock('../utils/settingsAccessor', () => ({
  getSettings: () => ({ minimizeToTray: false, aria2: { port: 6800 } })
}))

vi.mock('../utils/ConfigWatcher', () => ({
  ConfigWatcher: class {
    watch(): void {}
    unwatchAll(): void {}
  }
}))

// 这些控制器只被当作接口使用；真实模块会连带加载 electron 与大量服务，全部打桩
vi.mock('./WindowController', () => ({ WindowController: class {} }))
vi.mock('./TrayController', () => ({ TrayController: class {} }))
vi.mock('./Aria2Controller', () => ({ Aria2Controller: class {} }))
vi.mock('./IpcController', () => ({ IpcController: class {} }))

import { AppLifecycle } from './AppLifecycle'

/** 造一套最小可用的控制器替身；返回值同时暴露给断言使用 */
function makeHarness(overrides: { aria2Initialize?: () => Promise<void> } = {}) {
  const webContents = { send: vi.fn() }
  const mainWindow = {
    webContents,
    isDestroyed: () => false
  }
  const windowController = {
    createWindow: vi.fn(() => mainWindow),
    getMainWindow: vi.fn((): typeof mainWindow | null => mainWindow),
    show: vi.fn(),
    hide: vi.fn(),
    setWindowTheme: vi.fn(),
    isRendererContentReady: vi.fn(() => true)
  }
  const trayController = {
    createTray: vi.fn(),
    destroy: vi.fn(),
    getTray: vi.fn(() => null)
  }
  const aria2Controller = {
    initialize: vi.fn(overrides.aria2Initialize ?? (async () => {})),
    stop: vi.fn(async () => true)
  }
  const ipcController = { registerHandlers: vi.fn(), shutdown: vi.fn() }
  const store = { get: vi.fn(), onDidChange: vi.fn(), set: vi.fn() }

  const lifecycle = new AppLifecycle(
    store as never,
    windowController as never,
    trayController as never,
    aria2Controller as never,
    ipcController as never
  )

  return { lifecycle, windowController, trayController, aria2Controller, ipcController, mainWindow }
}

const originalArgv = [...process.argv]

beforeEach(() => {
  mocks.showMessageBox.mockReset()
  mocks.notificationShow.mockReset()
  mocks.openPath.mockReset()
  mocks.openPath.mockResolvedValue('')
})

afterEach(() => {
  process.argv = [...originalArgv]
})

describe('D-12 真无头', () => {
  it('--headless 时不创建主窗口，也不显示窗口', async () => {
    process.argv = [...originalArgv, '--headless']
    const h = makeHarness()

    await h.lifecycle.initialize()

    expect(h.windowController.createWindow).not.toHaveBeenCalled()
    expect(h.windowController.show).not.toHaveBeenCalled()
    // 无头模式仍然要初始化引擎与 IPC，否则只是把窗口藏起来，不是真无头
    expect(h.aria2Controller.initialize).toHaveBeenCalledTimes(1)
    expect(h.ipcController.registerHandlers).toHaveBeenCalledTimes(1)
    expect(h.trayController.createTray).not.toHaveBeenCalled()
  })

  it('非无头模式创建并显示窗口', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness()

    await h.lifecycle.initialize()

    expect(h.windowController.createWindow).toHaveBeenCalledTimes(1)
    expect(h.windowController.show).toHaveBeenCalledTimes(1)
  })

  it('建窗失败（无 DISPLAY）不致命：引擎照常初始化且不显示窗口', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    h.windowController.createWindow.mockImplementation(() => {
      throw new Error('Missing X server or $DISPLAY')
    })
    h.windowController.getMainWindow.mockReturnValue(null)

    await expect(h.lifecycle.initialize()).resolves.toBeUndefined()

    expect(h.aria2Controller.initialize).toHaveBeenCalledTimes(1)
    expect(h.windowController.show).not.toHaveBeenCalled()
  })
})

describe('D-20 启动失败分类', () => {
  it('端口被别的 aria2 占用时给出「更换端口」并打开引擎设置', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('RPC 端口 6800 已被另一个 aria2 实例占用（不认可本机密钥）')
      }
    })
    // actions[0] = change-port
    mocks.showMessageBox.mockResolvedValue({ response: 0 })

    await h.lifecycle.initialize()

    const dialogArgs = mocks.showMessageBox.mock.calls[0][0] as { buttons: string[]; detail: string }
    expect(dialogArgs.buttons[0]).toBe('更换端口')
    expect(dialogArgs.buttons).toContain('重试启动')
    expect(dialogArgs.buttons).toContain('查看日志')
    expect(dialogArgs.detail).toContain('6800')
    expect(h.mainWindow.webContents.send).toHaveBeenCalledWith('tray-action', 'open-engine-settings')
    // 换端口不阻断启动：不重试、不退出
    expect(h.aria2Controller.initialize).toHaveBeenCalledTimes(1)
  })

  it('选择「重试启动」会重新初始化引擎', async () => {
    process.argv = [...originalArgv]
    let attempts = 0
    const h = makeHarness({
      aria2Initialize: async () => {
        attempts++
        if (attempts === 1) throw new Error('Aria2 RPC 服务未就绪（端口 6800）。请检查该端口是否被其它程序占用')
      }
    })
    // port-in-use-unknown 的 actions = [retry, change-port, open-logs, continue, quit]
    mocks.showMessageBox.mockResolvedValue({ response: 0 })

    await h.lifecycle.initialize()

    expect(h.aria2Controller.initialize).toHaveBeenCalledTimes(2)
  })

  it('选择「退出应用」会走优雅关闭并抛出取消错误', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('Aria2 可执行文件不存在: /opt/aria2c')
      }
    })
    // missing-executable 的 actions = [open-logs, retry, continue, quit] → quit 在最后
    mocks.showMessageBox.mockResolvedValue({ response: 3 })

    await expect(h.lifecycle.initialize()).rejects.toThrow()
    expect(h.aria2Controller.stop).toHaveBeenCalledTimes(1)
  })

  it('选择「查看日志」后重新弹出对话框', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('Aria2 可执行文件不存在: /opt/aria2c')
      }
    })
    // 先选 open-logs(0)，再选 continue(2)
    mocks.showMessageBox
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 2 })

    await h.lifecycle.initialize()

    expect(mocks.openPath).toHaveBeenCalledWith('C:/logs')
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(2)
    expect(h.aria2Controller.initialize).toHaveBeenCalledTimes(1)
  })

  it('无头模式下启动失败直接抛错，不弹对话框', async () => {
    process.argv = [...originalArgv, '--headless']
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('Aria2 启动超时')
      }
    })

    await expect(h.lifecycle.initialize()).rejects.toThrow('Aria2 下载引擎启动失败')
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })
})

describe('D-21 引擎放弃重启的系统通知', () => {
  it('notifyEngineGaveUp 发送系统通知且带上失败次数', () => {
    process.argv = [...originalArgv]
    const h = makeHarness()

    h.lifecycle.notifyEngineGaveUp(3)

    expect(mocks.notificationShow).toHaveBeenCalledTimes(1)
    const options = mocks.notificationShow.mock.calls[0][0] as { title: string; body: string }
    expect(options.title).toContain('Aria2')
    expect(options.body).toContain('3')
    expect(options.body).toContain('自动重启')
  })
})
