/**
 * Release 订阅解析（纯函数，禁止 import electron）。
 *
 * 单独抽出的原因：更新检查里"哪个 tag 是稳定版""日志属于哪个 tag"是**只看字符串**的判定，
 * 却直接决定全体用户会不会被推向 pre-release。把它与网络/electron 解耦后可按真实
 * Location / atom 报文固化边界用例（含 tag 前缀相似的情况）。
 */

/** 反转义 atom 内容中的 HTML 实体（&amp; 必须最后处理，否则会二次解码） */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * 从 `releases/latest` 的 302 Location 中解析稳定版 tag。
 *
 * 形态：`https://github.com/<owner>/<repo>/releases/tag/v1.0.9`
 * 返回 null 表示这不是一个 tag 页跳转（调用方据此报错，而不是猜一个版本）。
 */
export function parseStableTagFromLocation(location: string): string | null {
  const match = /\/releases\/tag\/([^/<"'\s?#]+)/.exec(location)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]) || null
  } catch {
    return match[1] || null
  }
}

/** 从一条 atom entry 中提取所有 releases/tag/<tag> 的 tag（已解码） */
function tagsInEntry(entry: string): string[] {
  const tags: string[] = []
  for (const match of entry.matchAll(/\/releases\/tag\/([^/<"'\s?#]+)/g)) {
    try {
      tags.push(decodeURIComponent(match[1]))
    } catch {
      tags.push(match[1])
    }
  }
  return tags
}

/**
 * 从 releases.atom 中按 tag **精确匹配**取出更新日志。
 *
 * 为什么不能 `entry.includes('/tag/' + tag)`：`v1.1.0` 是 `v1.1.0-beta.1` 的前缀，
 * 用 includes 会把 pre-release 的日志当成正式版展示（甚至取错条目）。
 * 这里先抽取 entry 内所有 tag 再逐一比较，boundary 由解析结果保证。
 *
 * 未找到（常见于 atom 只保留最近若干条）返回空串：调用方按"日志缺失"降级。
 */
export function extractReleaseNotes(atomXml: string, tag: string): string {
  const entries = atomXml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
  for (const entry of entries) {
    if (!tagsInEntry(entry).includes(tag)) continue
    const content = /<content[^>]*>([\s\S]*?)<\/content>/.exec(entry)
    if (!content) continue
    return decodeHtmlEntities(content[1]).trim()
  }
  return ''
}
