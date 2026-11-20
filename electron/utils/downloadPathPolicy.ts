/**
 * 下载目录路径边界判定（主进程共用）。
 *
 * 为什么单独抽出来：文件打开/解压/删除、流媒体保存目录等入口必须用同一口径，
 * 否则某个入口用 path.startsWith 比较时，`C:\\DownloadsEvil` 会被误判为
 * `C:\\Downloads` 的子目录。这里统一 realpath + 大小写不敏感 + 分段前缀比较。
 */

import * as fs from 'fs'
import * as path from 'path'
import { isPathInside } from './pathContainment'

/**
 * 返回路径的真实路径；目标或其父目录尚不存在时，向上找到最近的存在祖先并拼回缺失段。
 *
 * 只对“目标本身”做 realpath 不够：保存目录常常是待创建的新目录，若其父级是符号链接，
 * 直接按字面路径判断会误以为仍在下载根目录内。
 */
async function realPathIfExists(targetPath: string): Promise<string> {
  const absolute = path.resolve(targetPath)
  const missingSegments: string[] = []
  let current = absolute
  while (true) {
    try {
      const real = await fs.promises.realpath(current)
      return path.join(real, ...missingSegments.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return absolute
      missingSegments.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * 判定 targetPath 是否位于 rootDir 内（含 rootDir 本身）。
 * 先解析符号链接，再做大小写不敏感比较，避免“校验时是链接、使用时已指向别处”的 TOCTOU 绕过。
 */
export async function isInsideDownloadRoot(
  targetPath: string,
  rootDir: string,
  caseInsensitive: boolean = process.platform === 'win32'
): Promise<boolean> {
  if (!targetPath || !rootDir) return false
  const normalizeCase = (value: string): string => (caseInsensitive ? value.toLowerCase() : value)
  const root = normalizeCase(await realPathIfExists(path.resolve(rootDir)))
  const target = normalizeCase(await realPathIfExists(path.resolve(targetPath)))
  return isPathInside(target, root, false)
}
