import { app } from 'electron'
import { join } from 'path'
import * as fs from 'fs'

/**
 * 生产环境资源路径解析（单一来源）。
 *
 * 背景与取舍：
 * 原先各处用"候选路径数组 + 逐个 existsSync 探测"（WindowController 4 个、TrayController 5 个）。
 * 经打包产物交叉验证，其中大部分候选**永远不会命中**（死代码），既误导维护者，
 * 也让"资源加载失败"这类问题难以定位（不知道到底该往哪放）。
 * 这里收敛为唯一路径，并由 `scripts/verify-resources.mjs` 在构建期断言资源就位——
 * 把"路径写错"从"用户启动时才发现"提前到"构建时失败"。
 *
 * 打包布局（依据 package.json 的 build 配置，已用 release/win-unpacked 产物核对）：
 *   主进程入口    <resources>/app.asar/dist/electron/electron/main.js
 *   渲染层产物    <resources>/app.asar/dist/vue/index.html
 *                 （dist/vue/** 在 asarUnpack 中，真实字节位于 app.asar.unpacked/dist/vue/，
 *                   Electron 的 asar 层会自动重定向，因此用 asar 内虚拟路径即可）
 *   应用图标      <resources>/Icon.ico
 *                 （extraResources 把 build/Icon.ico 映射为资源根下的 Icon.ico）
 *
 * 注意：开发环境（NODE_ENV=development）不使用本模块的渲染层分支（走 Vite dev server）；
 * 但"未打包 + 非 development"这一模式（直接 `electron .`）会用到，故必须同时正确。
 */

/**
 * 渲染层 index.html 的路径（唯一）。
 * - 打包环境：`<resources>/app.asar/dist/vue/index.html`
 *   （dist/vue/** 在 asarUnpack 中，真实字节位于 app.asar.unpacked/dist/vue/，
 *     Electron 的 asar 层会自动重定向，因此用 asar 内虚拟路径即可）
 * - 未打包但按**文件方式**加载（不走 Vite dev server，如直接 `electron .`）：
 *   仓库内的构建产物 `<appPath>/dist/vue/index.html`
 *
 * 第三种模式此前被漏掉：那时会拼出 asar 路径，导致窗口加载 ERR_FAILED（-2）、应用随即退出。
 * 用 app.getAppPath() 而非 process.cwd()：启动目录不一定是应用目录。
 */
export function resolveRendererIndexPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar', 'dist', 'vue', 'index.html')
  }
  return join(app.getAppPath(), 'dist', 'vue', 'index.html')
}

/**
 * 应用图标路径（窗口与托盘共用）。
 * - 打包环境：`<resources>/Icon.ico`（extraResources 提供）
 * - 未打包：仓库内 `build/Icon.ico`（相对应用目录，不依赖启动时的工作目录）
 *
 * 文件不存在时返回 null：窗口图标会被 Electron 忽略，托盘则回退到空图像（避免 Tray 构造抛错）。
 */
export function resolveAppIconPath(): string | null {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'Icon.ico')
    : join(app.getAppPath(), 'build', 'Icon.ico')
  return fs.existsSync(iconPath) ? iconPath : null
}
