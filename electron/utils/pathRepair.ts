/**
 * 路径修复：撤销 aria2 在 Windows 下偶发产生的"首层目录重复"。
 *
 * 背景：aria2 偶尔会上报 `D:\Downloads\Downloads\file.zip` 这类路径，而文件其实在
 * `D:\Downloads\file.zip`。以前是渲染层在每次删除前直接按正则改写路径——但这条改写
 * 是"猜"：如果用户本来就把文件放在 `D:\Downloads\Downloads\`（目录名与上层同名），
 * 改写会把删除目标指向 `D:\Downloads\file.zip`，删掉另一个同名的真实文件。
 *
 * 现在只在原路径确实不存在（ENOENT）时才使用这里的修复结果，作为兜底而非首选。
 */

/**
 * 若路径形如 `<盘符>\<段>\<段>\...`（相邻两段完全相同），返回去掉重复段的路径；
 * 否则返回 null。非 Windows 绝对路径一律返回 null（该缺陷只出现在 Windows）。
 */
export function undoDuplicatedSegment(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0) return null

  // 统一分隔符后再判断，兼容 aria2 混用 `/` 与 `\` 的输出
  const unified = input.replace(/[\\/]+/g, '\\')
  const match = unified.match(/^([a-zA-Z]:\\)([^\\]+)\\\2(?:\\(.*))?$/)
  if (!match) return null

  const drive = match[1]!
  const segment = match[2]!
  const rest = match[3]
  return rest === undefined ? `${drive}${segment}` : `${drive}${segment}\\${rest}`
}
