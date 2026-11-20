/**
 * 版本号比较（纯函数，独立于 electron / 网络层，便于单测）。
 */

interface ParsedVersion {
  core: number[]
  prerelease: string[] | null
}

/** 按 SemVer 解析：核心版本 + 可选预发布段；+build 元数据忽略 */
function parseVersion(version: string): ParsedVersion {
  const withoutBuild = version.split('+')[0] ?? version
  const dashIndex = withoutBuild.indexOf('-')
  const corePart = dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex)
  const prereleasePart = dashIndex === -1 ? '' : withoutBuild.slice(dashIndex + 1)
  return {
    core: corePart.split('.').map((n) => parseInt(n, 10) || 0),
    prerelease: prereleasePart ? prereleasePart.split('.') : null
  }
}

/** SemVer 预发布标识比较：数字段按数值，字母段按字典序，短者更小 */
function comparePrerelease(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i]
    const bi = b[i]
    if (ai === undefined && bi === undefined) return 0
    if (ai === undefined) return -1
    if (bi === undefined) return 1

    const aNumeric = /^[0-9]+$/.test(ai)
    const bNumeric = /^[0-9]+$/.test(bi)
    if (aNumeric && bNumeric) {
      const na = Number(ai)
      const nb = Number(bi)
      if (na > nb) return 1
      if (na < nb) return -1
      continue
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    if (ai > bi) return 1
    if (ai < bi) return -1
  }
  return 0
}

/**
 * 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0。
 *
 * 语义：
 * - 核心版本按 "." 分段做数值比较，段数不同时缺位补 0（"1.0" 与 "1.0.0" 相等）
 * - 同一核心版本下，正式版高于预发布版（"1.5.0" > "1.5.0-rc.1" > "1.5.0-beta.2"）
 * - 预发布标识按 SemVer：数字段按数值、字母段按字典序、短者更小
 * - "+build" 构建元数据不参与比较
 * - **调用方需先剥离 `v` 前缀**（如 tag `v1.0.7` → `1.0.7`）
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.core.length, pb.core.length)
  for (let i = 0; i < len; i++) {
    const na = pa.core[i] || 0
    const nb = pb.core[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }

  if (pa.prerelease === null && pb.prerelease === null) return 0
  if (pa.prerelease === null) return 1
  if (pb.prerelease === null) return -1
  return comparePrerelease(pa.prerelease, pb.prerelease)
}
