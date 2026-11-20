import { beforeEach, describe, expect, it, vi } from 'vitest'

// 托盘是「窗口隐藏后用户唯一还能看到的东西」。这里锁死三件容易退化的行为：
// 引擎放弃重启时必须置顶告警并能手动重启、tooltip 必须合并流媒体任务、
// 限速菜单项必须文案即状态（限速中显示具体值）。

const state = vi.hoisted(() => ({
  trayInstances: [] as Array<Record<string, unknown>>,
  menus: [] as Array<{ template: Array<Record<string, unknown>> }>,
  locale: 'zh' as 'zh' | 'en',
  speedLimit: null as null | { limited: boolean; limitBytes: number },
  toggled: null as null | { limited: boolean; limitBytes: number },
  rpcStat: null as null | Record<string, string>,
  tooltipCalls: [] as string[],
  iconPath: '/icon.png' as string | null,
  windowVisible: false,
  sentToRenderer: [] as string[]
}))

vi.mock('electron', () => {
  class FakeTray {
    handlers = new Map<string, () => void>()
    destroyed = false
    constructor(public image: unknown) {
      state.trayInstances.push(this as unknown as Record<string, unknown>)
    }
    setToolTip(text: string) { state.tooltipCalls.push(text) }
    setContextMenu(menu: { template: Array<Record<string, unknown>> }) { state.menus.push(menu) }
    on(event: string, handler: () => void) { this.handlers.set(event, handler) }
    destroy() { this.destroyed = true }
  }
  return {
    Tray: FakeTray,
    Menu: { buildFromTemplate: (template: Array<Record<string, unknown>>) => ({ template }) },
    app: { getLocale: () => (state.locale === 'zh' ? 'zh-CN' : 'en-US'), quit: vi.fn() },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: vi.fn() }),
      createEmpty: () => ({ empty: true })
    }
  }
})

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/resolvePaths', () => ({ resolveTrayIconPath: () => state.iconPath }))
vi.mock('../utils/speedLimitCore', () => ({ formatLimitLabel: (bytes: number) => `${Math.round(bytes / 1024)} KB/s` }))
vi.mock('../services/traySpeedLimit', () => ({
  readSpeedLimit: async () => state.speedLimit,
  toggleSpeedLimit: async () => state.toggled
}))
vi.mock('../utils/trayTooltip', () => ({
  buildTrayTooltip: (input: { downloadSpeed: number; activeCount: number; streamCount: number; zh: boolean }) =>
    `speed=${input.downloadSpeed} active=${input.activeCount} stream=${input.streamCount} zh=${input.zh}`
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: async () => state.rpcStat }))
vi.mock('../utils/activeRpcConfig', () => ({ activeRpcOptions: () => ({ host: '127.0.0.1' }) }))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: () => ({}) }))
vi.mock('../services/streamDownloadService', () => ({
  activeStreamDownloadCount: () => 2,
  activeStreamDownloadSpeedBytes: () => 100
}))

const { TrayController } = await import('./TrayController')
const { appState } = await import('../utils/appState')

function fakeWindowController() {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    isVisible: () => state.windowVisible,
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (_channel: string, action: string) => state.sentToRenderer.push(action) }
    })
  }
}

/** 取最近一次构建的菜单里的可点击项（按 label 找） */
function menuItem(label: string): Record<string, unknown> | undefined {
  const menu = state.menus[state.menus.length - 1]
  return menu?.template.find(item => item.label === label)
}

function allLabels(): string[] {
  const menu = state.menus[state.menus.length - 1]
  return (menu?.template ?? []).map(item => String(item.label ?? ''))
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('TrayController', () => {
  beforeEach(() => {
    state.trayInstances.length = 0
    state.menus.length = 0
    state.tooltipCalls.length = 0
    state.sentToRenderer.length = 0
    state.locale = 'zh'
    state.speedLimit = null
    state.toggled = null
    state.rpcStat = null
    state.iconPath = '/icon.png'
    state.windowVisible = false
  })

  it('创建托盘后设置初始 tooltip 与上下文菜单', async () => {
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    expect(state.trayInstances).toHaveLength(1)
    expect(state.tooltipCalls[0]).toBe('Aria2 Desktop')
    expect(allLabels()).toContain('新建下载')
    expect(allLabels()).toContain('设置')
    expect(allLabels()).toContain('退出')
    controller.destroy()
  })

  it('重复创建不会产生第二个托盘', () => {
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    controller.createTray()
    expect(state.trayInstances).toHaveLength(1)
    controller.destroy()
  })

  it('图标缺失时回退到空图像而不是抛错', () => {
    state.iconPath = null
    const controller = new TrayController(fakeWindowController() as never)
    expect(() => controller.createTray()).not.toThrow()
    expect(state.trayInstances).toHaveLength(1)
    controller.destroy()
  })

  it('英文系统下菜单文案切换为英文', () => {
    state.locale = 'en'
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    expect(allLabels()).toContain('New Download')
    expect(allLabels()).toContain('Quit')
    controller.destroy()
  })

  it('引擎放弃重启后菜单置顶告警项与「重启引擎」', () => {
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    controller.setEngineGaveUp(5)
    const labels = allLabels()
    expect(labels[0]).toContain('引擎异常：已停止自动重启')
    expect(labels[0]).toContain('5')
    expect(labels[1]).toBe('重启引擎')
    controller.destroy()
  })

  it('「重启引擎」把 restart-engine 交给渲染层执行', () => {
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    controller.setEngineGaveUp(3)
    ;(menuItem('重启引擎')?.click as () => void)()
    expect(state.sentToRenderer).toContain('restart-engine')
    controller.destroy()
  })

  it('引擎恢复后告警项消失', () => {
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    controller.setEngineGaveUp(3)
    controller.clearEngineGaveUp()
    expect(allLabels()).not.toContain('重启引擎')
    expect(allLabels()[0]).toBe('新建下载')
    controller.destroy()
  })

  it('tooltip 合并流媒体任务与引擎统计', async () => {
    state.rpcStat = { downloadSpeed: '2048', numActive: '1' }
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    await flush()
    const last = state.tooltipCalls[state.tooltipCalls.length - 1]
    expect(last).toBe('speed=2048 active=1 stream=2 zh=true')
    controller.destroy()
  })

  it('引擎不可达时 tooltip 仍显示流媒体任务（不显示误导性的 0 活动）', async () => {
    state.rpcStat = null
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    await flush()
    const last = state.tooltipCalls[state.tooltipCalls.length - 1]
    expect(last).toBe('speed=0 active=0 stream=2 zh=true')
    controller.destroy()
  })

  it('引擎放弃重启后 tooltip 直接说明，不再显示速度', async () => {
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    state.tooltipCalls.length = 0
    controller.setEngineGaveUp(4)
    await flush()
    expect(state.tooltipCalls[0]).toContain('引擎已停止自动重启')
    expect(state.tooltipCalls[0]).toContain('4')
    controller.destroy()
  })

  it('限速状态未知时菜单给中性提示', async () => {
    state.speedLimit = null
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    await flush()
    expect(allLabels().some(label => label.includes('状态未知'))).toBe(true)
    controller.destroy()
  })

  it('限速中菜单直接显示当前限速值（文案即状态）', async () => {
    state.speedLimit = { limited: true, limitBytes: 1024 * 500 }
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    await flush()
    expect(allLabels().some(label => label === '下载限速：500 KB/s')).toBe(true)
    controller.destroy()
  })

  it('不限速时菜单显示「不限速」', async () => {
    state.speedLimit = { limited: false, limitBytes: 0 }
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    await flush()
    expect(allLabels().some(label => label === '下载限速：不限速')).toBe(true)
    controller.destroy()
  })

  it('点限速项切换后按新状态重建菜单并通知渲染层', async () => {
    state.speedLimit = { limited: false, limitBytes: 0 }
    state.toggled = { limited: true, limitBytes: 1024 * 1024 }
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    await flush()
    const item = state.menus[state.menus.length - 1].template.find(entry => String(entry.label ?? '').startsWith('下载限速'))
    ;(item?.click as () => void)()
    await flush()
    expect(allLabels().some(label => label === '下载限速：1024 KB/s')).toBe(true)
    expect(state.sentToRenderer).toContain('speed-limit-changed')
    controller.destroy()
  })

  it('双击托盘在显示与隐藏之间切换', () => {
    const wc = fakeWindowController()
    const controller = new TrayController(wc as never)
    controller.createTray()
    const tray = state.trayInstances[0] as unknown as { handlers: Map<string, () => void> }
    state.windowVisible = false
    tray.handlers.get('double-click')?.()
    expect(wc.show).toHaveBeenCalledTimes(1)
    state.windowVisible = true
    tray.handlers.get('double-click')?.()
    expect(wc.hide).toHaveBeenCalledTimes(1)
    controller.destroy()
  })

  it('退出项先标记 quitting 再退出应用（放行窗口 close 拦截）', () => {
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    const quitItem = menuItem('退出')
    ;(quitItem?.click as () => void)()
    expect(appState.isQuitting()).toBe(true)
    controller.destroy()
  })

  it('destroy 销毁托盘并停止 tooltip 定时器', () => {
    const controller = new TrayController(fakeWindowController() as never)
    controller.createTray()
    const tray = state.trayInstances[0] as unknown as { destroyed: boolean }
    controller.destroy()
    expect(tray.destroyed).toBe(true)
    expect(controller.getTray()).toBeNull()
  })
})
