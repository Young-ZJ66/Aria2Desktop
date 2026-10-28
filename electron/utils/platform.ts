/**
 * 平台/架构映射（主进程唯一口径）。
 *
 * 为什么单独成文件：引擎目录名要同时被三处使用——
 * 1. `package.json` 的 `extraResources.from`（用 electron-builder 的 `${arch}` 宏）；
 * 2. `scripts/verify-engine.mjs`（打包前校验，Node 侧）；
 * 3. `ResourceManager`（运行时定位，TS 侧）。
 * 三者必须给出同一个答案，否则打包产物里引擎缺失、而开发环境又找得到，问题只在用户机器上暴露。
 *
 * 刻意不 import electron：纯查表函数，便于将来加平台或写单测。
 */

/**
 * Node 的 `arch` → 仓库里的引擎子目录名。
 *
 * - Windows arm64 复用 x64 引擎（Windows on ARM 可跑 x64，与 Motrix 同策略）；
 * - Linux 的 `arm` 在 Node 里是 armv7l，目录名沿用发行版习惯；
 * - 其余按原样，未知架构原样返回（打包时会因目录不存在而明确失败）。
 */
export function getEngineArchDir(platform: string, arch: string): string {
  if (platform === 'win32') {
    return arch === 'ia32' ? 'ia32' : 'x64'
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'arm64' : 'x64'
  }
  if (platform === 'linux') {
    if (arch === 'arm') return 'armv7l'
    return arch === 'arm64' ? 'arm64' : 'x64'
  }
  return arch
}
