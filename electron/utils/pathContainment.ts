/**
 * 路径包含关系判定（"target 是否在 root 之下"）。
 *
 * 这里最容易写错的是**盘符根**：`path.resolve('D:\\')` 的结果自带结尾分隔符，
 * 若直接拼 `root + path.sep` 就变成 `D:\\`（两个反斜杠），`D:\Downloads\x` 反而判不通过。
 * 结果就是"下载目录设成盘符根时，删除文件/解压全被拒"。
 *
 * 另一个坑是前缀陷阱：`C:\Downloads2\x` 以 `C:\Downloads` 开头，但不在其下，
 * 所以必须带上分隔符再比较。
 */

/**
 * @param target 被检查的路径（调用方负责先 resolve / realpath）
 * @param root 允许的根目录（调用方负责先 resolve / realpath）
 * @param caseInsensitive Windows 文件系统大小写不敏感，需按小写比较
 */
export function isPathInside(
  target: string,
  root: string,
  caseInsensitive: boolean = process.platform === 'win32'
): boolean {
  if (!target || !root) return false

  const norm = (value: string): string => {
    const unified = value.replace(/[\\/]+/g, '/')
    // 去掉结尾分隔符，但保留纯盘符根（C:/）与根目录（/）
    const trimmed = unified.length > 1 ? unified.replace(/\/+$/, '') : unified
    return caseInsensitive ? trimmed.toLowerCase() : trimmed
  }

  const normalizedTarget = norm(target)
  const normalizedRoot = norm(root)
  if (!normalizedTarget || !normalizedRoot) return false
  if (normalizedTarget === normalizedRoot) return true

  return normalizedTarget.startsWith(
    normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`
  )
}
