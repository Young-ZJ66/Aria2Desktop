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
  logFilePaths: vi.fn(() => ({ file: 'C:/logs/app.log', dir: 'C:/logs' })),
  settings: { minimizeToTray: false, aria2: { port: 6800 } } as Record<string, unknown>,
  settingsThrows: false,
  notificationSupported: true,
  notificationThrows: false,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  /** ConfigWatcher 注册的回调：键 → 回调，用例可手动触发 */
  watchers: new Map<string, (newValue: unknown, oldValue: unknown) => void>()
}))

vi.mock('electron', () => ({
  dialog: { showMessageBox: (...args: unknown[]) => mocks.showMessageBox(...args) },
  shell: { openPath: (dir: string) => mocks.openPath(dir) },
  Notification: class {
    static isSupported(): boolean {
      return mocks.notificationSupported
    }
    constructor(public options: unknown) {}
    show(): void {
      if (mocks.notificationThrows) throw new Error('notification backend down')
      mocks.notificationShow(this.options)
    }
  }
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => mocks.log,
  getLogFilePaths: () => mocks.logFilePaths()
}))

vi.mock('../utils/settingsAccessor', () => ({
  getSettings: () => {
    if (mocks.settingsThrows) throw new Error('settings unreadable')
    return mocks.settings
  }
}))

vi.mock('../utils/ConfigWatcher', () => ({
  ConfigWatcher: class {
    watch(key: string, cb: (newValue: unknown, oldValue: unknown) => void): void {
      mocks.watchers.set(key, cb)
    }
    unwatchAll(): void {
      mocks.watchers.clear()
    }
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
  mocks.settings = { minimizeToTray: false, aria2: { port: 6800 } }
  mocks.settingsThrows = false
  mocks.notificationSupported = true
  mocks.notificationThrows = false
  mocks.watchers.clear()
  for (const fn of Object.values(mocks.log)) fn.mockReset()
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

describe('D-21 系统通知的降级路径', () => {
  it('系统通知不可用时只记日志，不抛错', () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    mocks.notificationSupported = false

    expect(() => h.lifecycle.notifyEngineGaveUp(5)).not.toThrow()

    expect(mocks.notificationShow).not.toHaveBeenCalled()
    const warned = mocks.log.warn.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(warned).toContain('系统通知不可用')
    const errored = mocks.log.error.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(errored).toContain('5')
  })

  it('通知后端抛错时不冒到调用方（引擎放弃重启不能反过来搞崩应用）', () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    mocks.notificationThrows = true

    expect(() => h.lifecycle.notifyEngineGaveUp(2)).not.toThrow()

    const warned = mocks.log.warn.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(warned).toContain('发送引擎异常系统通知失败')
  })
})

describe('启动失败对话框的辅助路径', () => {
  it('设置读不到时端口提示回落到 null（对话框仍要弹出来）', async () => {
    process.argv = [...originalArgv]
    mocks.settingsThrows = true
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('请检查该端口是否被其它程序占用')
      }
    })
    // port-in-use-unknown 的 actions = [retry, change-port, open-logs, continue, quit]
    // 先看日志(2)，再选继续(3)；不能一直选「查看日志」，否则对话框会无限重弹
    mocks.showMessageBox.mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 3 })

    // 设置读不到 → 后续建托盘也会抛错，initialize 最终以错误结束
    await expect(h.lifecycle.initialize()).rejects.toThrow('settings unreadable')

    expect(mocks.showMessageBox).toHaveBeenCalledTimes(2)
    const args = mocks.showMessageBox.mock.calls[0][0] as { detail: string }
    // 端口读不到时文案用「当前端口」而不是编造一个数字
    expect(args.detail).toContain('当前端口')
  })

  it('打开日志目录失败时只告警，然后照常重新弹窗', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('Aria2 可执行文件不存在: /opt/aria2c')
      }
    })
    mocks.openPath.mockResolvedValue('EACCES: permission denied')
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 2 })

    await h.lifecycle.initialize()

    const warned = mocks.log.warn.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(warned).toContain('打开日志目录失败')
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(2)
  })

  it('打开日志目录抛错时同样只告警', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('Aria2 可执行文件不存在: /opt/aria2c')
      }
    })
    mocks.openPath.mockRejectedValue(new Error('shell unavailable'))
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 2 })

    await h.lifecycle.initialize()

    const warned = mocks.log.warn.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(warned).toContain('打开日志目录异常')
  })

  it('无主窗口时选「更换端口」只告警，不会崩', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('RPC 端口 6800 已被另一个 aria2 实例占用（不认可本机密钥）')
      }
    })
    h.windowController.getMainWindow.mockReturnValue(null)
    mocks.showMessageBox.mockResolvedValue({ response: 0 })

    await h.lifecycle.initialize()

    const warned = mocks.log.warn.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(warned).toContain('无主窗口，无法打开引擎设置')
  })

  it('渲染层还没就绪时先等一会儿再投递，不把消息丢进黑洞', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('RPC 端口 6800 已被另一个 aria2 实例占用（不认可本机密钥）')
      }
    })
    // 前两次轮询返回未就绪，第三次就绪：模拟页面还在加载
    let readyChecks = 0
    h.windowController.isRendererContentReady.mockImplementation(() => {
      readyChecks += 1
      return readyChecks > 2
    })
    mocks.showMessageBox.mockResolvedValue({ response: 0 })

    await h.lifecycle.initialize()

    expect(readyChecks).toBeGreaterThan(2)
    expect(h.mainWindow.webContents.send).toHaveBeenCalledWith('tray-action', 'open-engine-settings')
  })

  it('等待期间主窗口被销毁则放弃投递并告警', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness({
      aria2Initialize: async () => {
        throw new Error('RPC 端口 6800 已被另一个 aria2 实例占用（不认可本机密钥）')
      }
    })
    let readyChecks = 0
    h.windowController.isRendererContentReady.mockImplementation(() => {
      readyChecks += 1
      return readyChecks > 1
    })
    // 首次取窗口用于判断"有没有主窗口"，之后就销毁了
    let windowChecks = 0
    h.windowController.getMainWindow.mockImplementation(() => {
      windowChecks += 1
      return windowChecks <= 1 ? h.mainWindow : null
    })
    mocks.showMessageBox.mockResolvedValue({ response: 0 })

    await h.lifecycle.initialize()

    const warned = mocks.log.warn.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(warned).toContain('主窗口已销毁')
    expect(h.mainWindow.webContents.send).not.toHaveBeenCalledWith('tray-action', 'open-engine-settings')
  })
})

describe('配置监听器与托盘', () => {
  it('主题变更时切换窗口主题并通知渲染层', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    await h.lifecycle.initialize()

    mocks.watchers.get('settings.theme')?.('dark', 'light')

    expect(h.windowController.setWindowTheme).toHaveBeenCalledWith(true)
    expect(h.mainWindow.webContents.send).toHaveBeenCalledWith('config:changed', { key: 'theme', value: 'dark' })
  })

  it('主题变更时没有主窗口也不崩（只切换主题）', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    await h.lifecycle.initialize()
    h.windowController.getMainWindow.mockReturnValue(null)

    mocks.watchers.get('settings.theme')?.('light', 'dark')

    expect(h.windowController.setWindowTheme).toHaveBeenCalledWith(false)
    expect(h.mainWindow.webContents.send).not.toHaveBeenCalledWith('config:changed', { key: 'theme', value: 'light' })
  })

  it('刷新间隔变更转发给渲染层', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    await h.lifecycle.initialize()

    mocks.watchers.get('settings.refreshInterval')?.(5000, 1000)

    expect(h.mainWindow.webContents.send).toHaveBeenCalledWith('config:changed', { key: 'refreshInterval', value: 5000 })
  })

  it('最小化到托盘开关打开时创建托盘、关闭时销毁', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    await h.lifecycle.initialize()
    const watcher = mocks.watchers.get('settings.minimizeToTray')

    h.trayController.getTray.mockReturnValue(null)
    watcher?.(true, false)
    expect(h.trayController.createTray).toHaveBeenCalled()

    h.trayController.getTray.mockReturnValue({} as never)
    h.trayController.createTray.mockClear()
    watcher?.(true, true)
    // 托盘已存在时不重复创建
    expect(h.trayController.createTray).not.toHaveBeenCalled()

    watcher?.(false, true)
    expect(h.trayController.destroy).toHaveBeenCalled()
  })

  it('minimizeToTray 默认开启：初始化时就建托盘', async () => {
    process.argv = [...originalArgv]
    mocks.settings = { minimizeToTray: true }
    const h = makeHarness()

    await h.lifecycle.initialize()

    expect(h.trayController.createTray).toHaveBeenCalledTimes(1)
  })
})

describe('优雅关闭', () => {
  it('重复关闭只走一次（第二次直接返回）', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    await h.lifecycle.initialize()

    await h.lifecycle.shutdown()
    await h.lifecycle.shutdown()

    expect(h.aria2Controller.stop).toHaveBeenCalledTimes(1)
    expect(h.ipcController.shutdown).toHaveBeenCalledTimes(1)
    expect(h.windowController.hide).toHaveBeenCalledTimes(1)
    expect(h.trayController.destroy).toHaveBeenCalledTimes(1)
  })

  it('停止引擎抛错时仍然走完关闭流程且不冒泡', async () => {
    process.argv = [...originalArgv]
    const h = makeHarness()
    await h.lifecycle.initialize()
    h.aria2Controller.stop.mockRejectedValue(new Error('stop failed'))

    await expect(h.lifecycle.shutdown()).resolves.toBeUndefined()

    const errored = mocks.log.error.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(errored).toContain('Shutdown error')
    // 关窗与托盘收尾必须已经执行（用户点了退出就得消失）
    expect(h.windowController.hide).toHaveBeenCalled()
    expect(h.trayController.destroy).toHaveBeenCalled()
  })
})
