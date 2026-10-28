import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createLogger } from '../utils/logger'

const logger = createLogger('AutoLaunch')

/**
 * 开机自启（三平台）。
 *
 * Windows / macOS 走 Electron 的 `app.setLoginItemSettings`（分别写注册表 Run 项 / LaunchAgent）。
 * Linux 没有等价 API，按 XDG 规范写 `~/.config/autostart/*.desktop`——桌面环境（GNOME/KDE/XFCE）
 * 都认这个目录，也是发行版打包时最常见的方式。
 *
 * 为什么单独成模块：原先这段逻辑写在 IpcController 里并标注"仅 Windows 支持"，
 * 而设置页对 Linux 用户仍会显示开关、点了却什么都不发生——"看起来支持、实际不支持"比明确不支持更糟。
 */

/** Linux 自启项文件（遵循 XDG_CONFIG_HOME，未设置时回落 ~/.config） */
function getDesktopFilePath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configHome, 'autostart', 'aria2-desktop.desktop')
}

/**
 * Linux 下的启动命令。
 * AppImage 运行时 `process.execPath` 指向**临时挂载点**（每次启动都变），
 * 必须用 `$APPIMAGE` 才能指向用户实际保存的那个文件，否则自启项下次开机就失效。
 */
function getLaunchCommand(): string {
  return process.env.APPIMAGE || process.execPath
}

/** 桌面项 Exec 值的引号内转义（按 Desktop Entry 规范转义 " ` $ \） */
function quoteDesktopExec(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`
}

/** 查询当前是否已启用。读失败一律按"未启用"处理（例如受限环境拿不到登录项信息） */
export function getAutoLaunchEnabled(): boolean {
  if (process.platform === 'linux') {
    try {
      return fs.existsSync(getDesktopFilePath())
    } catch {
      return false
    }
  }
  try {
    return app.getLoginItemSettings().openAtLogin
  } catch (error) {
    logger.warn('读取开机自启状态失败:', error)
    return false
  }
}

/** 设置开机自启。失败时抛出，由 IPC 层如实回报给用户（不谎报成功） */
export function setAutoLaunchEnabled(enabled: boolean): void {
  if (process.platform === 'linux') {
    const filePath = getDesktopFilePath()
    if (!enabled) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Aria2 Desktop',
      'Comment=Modern download manager',
      `Exec=${quoteDesktopExec(getLaunchCommand())}`,
      'Terminal=false',
      // 部分桌面环境（GNOME 旧版）需要这一项才会真正在登录时拉起
      'X-GNOME-Autostart-enabled=true',
      ''
    ].join('\n')
    fs.writeFileSync(filePath, content, 'utf-8')
    return
  }

  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
}
