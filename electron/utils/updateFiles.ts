/**
 * 判断 temp 目录里的 Aria2Desktop 更新文件是否为可清理的陈旧产物。
 *
 * 更新下载会在 temp 留下两类文件：
 * - 当前版本正在续传的 `<installer>.download`；
 * - 已下载并转正的安装包（Windows .exe / macOS .dmg / Linux .AppImage）。
 *
 * 后者在安装完成后不会再被使用，旧版本继续留在 temp 只会占用磁盘空间。
 * 当前目标文件（含正在续传的 .download）必须保留，否则会破坏断点续传或误删刚下好的包。
 */
const COMPLETED_INSTALLER_RE = /\.(?:exe|dmg|appimage)$/i

export function isStaleUpdateFile(name: string, keepFileName: string): boolean {
  if (!name.startsWith('Aria2Desktop-')) return false
  // 当前版本的目标文件与续传文件都不能删
  if (name === keepFileName || name === `${keepFileName}.download`) return false
  return name.toLowerCase().endsWith('.download') || COMPLETED_INSTALLER_RE.test(name)
}
