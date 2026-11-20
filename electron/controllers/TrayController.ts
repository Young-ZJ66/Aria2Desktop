import { Tray, Menu, app, nativeImage } from 'electron'
import { WindowController } from './WindowController'
import { appState } from '../utils/appState'
import { resolveTrayIconPath } from '../utils/resolvePaths'
import { createLogger } from '../utils/logger'
import { formatLimitLabel } from '../utils/speedLimitCore'
import { readSpeedLimit, toggleSpeedLimit } from '../services/traySpeedLimit'
import { buildTrayTooltip } from '../utils/trayTooltip'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { activeStreamDownloadCount, activeStreamDownloadSpeedBytes } from '../services/streamDownloadService'

// 本文件日志文案自带 [TrayController] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

export class TrayController {
  private tray: Tray | null = null
  private windowController: WindowController
  /** 当前限速状态快照（null = 尚未读到/引擎不可达，菜单显示中性文案） */
  private speedLimitState: { limited: boolean; limitBytes: number } | null = null
  /** tooltip 刷新定时器（托盘存在期间才有；窗口隐藏时它是唯一的进度反馈） */
  private tooltipTimer: NodeJS.Timeout | null = null
  /**
   * 引擎「已放弃自动重启」时的连续失败次数（null = 引擎正常/未放弃）。
   *
   * 为什么托盘要记这个状态：引擎彻底不重启之后，窗口可能被隐藏、渲染层可能根本没起来，
   * 此时托盘是用户唯一还能看到的东西。过去这种情况托盘仍显示"Aria2 Desktop"和限速状态，
   * 看起来一切正常，用户只会觉得"下载卡住了"。
   */
  private engineGaveUpAttempts: number | null = null

  constructor(windowController: WindowController) {
    this.windowController = windowController
  }

  public createTray(): void {
    if (this.tray) return

    const iconPath = this.getIconPath()
    logger.info('[TrayController] Creating tray with icon:', iconPath)

    try {
      // 图标路径不存在时回退到空图像，避免 Tray 构造抛错
      const image = this.buildTrayImage()
      this.tray = new Tray(image ?? nativeImage.createEmpty())
      this.setupContextMenu()
      this.setupEventHandlers()
      this.tray.setToolTip('Aria2 Desktop')
      // 异步取一次当前限速状态刷新菜单文案（引擎未运行时保持中性文案，静默即可）
      void this.refreshSpeedLimitState()
      // tooltip 定时刷新：托盘图标是窗口隐藏后唯一的进度入口，固定显示应用名等于没有反馈
      this.startTooltipUpdates()
    } catch (error) {
      logger.error('Failed to create tray:', error)
    }
  }

  private getIconPath(): string | null {
    // 图标路径口径统一在 resolvePaths（此前这里维护了 5 个候选路径，绝大多数永不命中）
    return resolveTrayIconPath()
  }

  /**
   * 构造托盘图像。
   *
   * macOS/Linux 的托盘只有 22~24px：直接把 1024px 的 PNG 交给 Tray 会被系统粗暴缩放，
   * 因此先按目标尺寸重采样；Windows 仍用多尺寸 .ico（系统会自行挑选合适的一档）。
   */
  private buildTrayImage(): Electron.NativeImage | string | null {
    const iconPath = this.getIconPath()
    if (!iconPath) return null
    if (process.platform === 'win32') return iconPath

    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) return iconPath
    return image.resize({ width: 22, height: 22, quality: 'best' })
  }

  private setupContextMenu() {
    if (!this.tray) return

    // 按系统语言切换托盘菜单文案（主进程无 i18n 实例，简单分流中英文）
    const isZh = app.getLocale().startsWith('zh')
    const labels = {
      newTask: isZh ? '新建下载' : 'New Download',
      settings: isZh ? '设置' : 'Settings',
      pauseAll: isZh ? '暂停全部' : 'Pause All',
      resumeAll: isZh ? '恢复全部' : 'Resume All',
      speedLimit: isZh ? '下载限速' : 'Speed Limit',
      unlimited: isZh ? '不限速' : 'Unlimited',
      unknown: isZh ? '状态未知（引擎未运行？）' : 'Unknown (engine not running?)',
      show: isZh ? '显示主窗口' : 'Show Main Window',
      hide: isZh ? '隐藏窗口' : 'Hide Window',
      quit: isZh ? '退出' : 'Quit',
      engineStopped: isZh ? '引擎异常：已停止自动重启' : 'Engine failed: auto-restart stopped',
      restartEngine: isZh ? '重启引擎' : 'Restart Engine'
    }

    const contextMenu = Menu.buildFromTemplate([
      // 引擎异常态置顶：托盘里唯一需要用户立刻处理的条目，不能埋在菜单底部
      ...(this.engineGaveUpAttempts === null
        ? []
        : [
          {
            label: `${labels.engineStopped}（${this.engineGaveUpAttempts}）`,
            enabled: false
          },
          {
            label: labels.restartEngine,
            click: () => this.sendAction('restart-engine')
          },
          { type: 'separator' as const }
        ]),
      {
        label: labels.newTask,
        click: () => this.sendAction('new-task')
      },
      {
        label: labels.settings,
        click: () => this.sendAction('settings')
      },
      { type: 'separator' },
      {
        label: labels.pauseAll,
        click: () => this.sendAction('pause-all')
      },
      {
        label: labels.resumeAll,
        click: () => this.sendAction('resume-all')
      },
      {
        // 快捷限速：文案即状态（限速中显示当前值，点击切换）
        label: this.speedLimitMenuItemLabel(labels),
        click: () => {
          void this.toggleSpeedLimitFromTray()
        }
      },
      { type: 'separator' },
      {
        label: labels.show,
        click: () => this.windowController.show()
      },
      {
        label: labels.hide,
        click: () => this.windowController.hide()
      },
      { type: 'separator' },
      {
        label: labels.quit,
        click: () => {
          // 先 markQuitting 放行窗口 close 拦截（minimizeToTray 时窗口仍可能可见）；
          // 优雅关闭（Aria2 会话保存）由 main.ts 的 before-quit 统一执行
          appState.markQuitting()
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  /** 限速菜单项文案：状态未知给中性提示，限速中显示当前值（文案即状态） */
  private speedLimitMenuItemLabel(labels: { speedLimit: string; unlimited: string; unknown: string }): string {
    if (!this.speedLimitState) return `${labels.speedLimit}（${labels.unknown}）`
    if (!this.speedLimitState.limited) return `${labels.speedLimit}：${labels.unlimited}`
    return `${labels.speedLimit}：${formatLimitLabel(this.speedLimitState.limitBytes)}`
  }

  /**
   * 启动 tooltip 定时刷新。
   *
   * 频率取 2s：与引擎状态轮询同量级，对 CPU 无感；只在托盘存在时运行。
   * 流媒体任务（yt-dlp）不进 aria2 队列，必须单独合并进来，否则用户下视频时
   * 托盘一直显示 0 B/s（D-10 一期）。
   */
  private startTooltipUpdates(): void {
    if (this.tooltipTimer) return
    void this.refreshTooltip()
    this.tooltipTimer = setInterval(() => {
      void this.refreshTooltip()
    }, 2000)
    // 定时器不应阻止进程退出（托盘销毁时会显式清理，这里再兜一层）
    this.tooltipTimer.unref?.()
  }

  /** 读取 aria2 全局统计并合并流媒体任务，刷新托盘 tooltip；引擎不可达时退化为只显示流媒体 */
  private async refreshTooltip(): Promise<void> {
    if (!this.tray) return
    // 引擎异常态优先：此时再去拉 RPC 统计只会拿到 0，显示"0 B/s"会误导成"空闲"
    if (this.engineGaveUpAttempts !== null) {
      const zh = app.getLocale().startsWith('zh')
      this.tray.setToolTip(
        zh
          ? `Aria2 Desktop — 引擎已停止自动重启（连续失败 ${this.engineGaveUpAttempts} 次）`
          : `Aria2 Desktop — engine stopped after ${this.engineGaveUpAttempts} failed restarts`
      )
      return
    }
    let downloadSpeed = 0
    let activeCount = 0
    try {
      const stat = (await callAria2Rpc({
        ...activeRpcOptions(getSettingsFresh()),
        method: 'aria2.getGlobalStat'
      })) as Record<string, string> | undefined
      downloadSpeed = Number(stat?.downloadSpeed) || 0
      activeCount = Number(stat?.numActive) || 0
    } catch {
      // 引擎未运行/连接失败：保持 0，只看流媒体任务（静默，不刷日志）
    }
    this.tray?.setToolTip(buildTrayTooltip({
      downloadSpeed,
      activeCount,
      streamCount: activeStreamDownloadCount(),
      streamSpeed: activeStreamDownloadSpeedBytes(),
      zh: app.getLocale().startsWith('zh')
    }))
  }

  /**
   * 标记引擎已放弃自动重启（由 main.ts 在 engine-gave-up 事件里调用）。
   *
   * 只改托盘自身的呈现（菜单 + tooltip），不碰引擎：重启必须由用户显式触发。
   */
  public setEngineGaveUp(attempts: number): void {
    this.engineGaveUpAttempts = attempts
    this.setupContextMenu()
    void this.refreshTooltip()
  }

  /** 引擎恢复（任一次成功启动）后清除异常态 */
  public clearEngineGaveUp(): void {
    if (this.engineGaveUpAttempts === null) return
    this.engineGaveUpAttempts = null
    this.setupContextMenu()
    void this.refreshTooltip()
  }

  private stopTooltipUpdates(): void {
    if (!this.tooltipTimer) return
    clearInterval(this.tooltipTimer)
    this.tooltipTimer = null
  }

  /** 拉取当前限速状态并重建菜单（引擎不可达时保留当前菜单不变） */
  private async refreshSpeedLimitState(): Promise<void> {
    const snapshot = await readSpeedLimit()
    if (!snapshot) return
    this.speedLimitState = snapshot
    this.setupContextMenu()
  }

  /** 托盘点按切换限速：切换成功后按新状态重建菜单（失败保持原样，日志已记录） */
  private async toggleSpeedLimitFromTray(): Promise<void> {
    const snapshot = await toggleSpeedLimit()
    if (!snapshot) return
    this.speedLimitState = snapshot
    this.setupContextMenu()
    // 通知渲染层重载全局选项（AppFooter 的限速开关状态据此保持一致；不弹窗）
    const win = this.windowController.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('tray-action', 'speed-limit-changed')
    }
  }

  /** 托盘的快捷动作统一交给渲染层执行（新建/设置/暂停/恢复都依赖前端状态） */
  private sendAction(action: string) {
    this.windowController.show()
    const win = this.windowController.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('tray-action', action)
    }
  }

  private setupEventHandlers() {
    if (!this.tray) return

    this.tray.on('double-click', () => {
      if (this.windowController.isVisible()) {
        this.windowController.hide()
      } else {
        this.windowController.show()
      }
    })
  }

  public getTray(): Tray | null {
    return this.tray
  }

  public destroy() {
    this.stopTooltipUpdates()
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
      logger.info('[TrayController] Tray destroyed')
    }
  }
}
