/**
 * RSS/Atom 订阅源解析（纯函数，零第三方依赖）。
 *
 * 为什么不用 XML 解析库：主进程没有 DOMParser，可用库都要新增 npm 依赖；
 * 订阅源里我们关心的字段（title/link/guid/enclosure/pubDate）结构固定且层次浅，
 * 正则提取足够可靠。坏输入一律返回 items:[] 而不是抛异常——调用方是 60 秒一跳的
 * 定时器，抛异常会把整个轮询打挂（见 rssSubscriptionService）。
 *
 * 支持范围（对齐任务契约）：RSS 2.0 的 <item> 与 Atom 的 <entry>；
 * 命名空间前缀（如 <atom:link>）不参与解析，只认标准写法。
 */

/** 解析出的一条订阅条目 */
export interface FeedItem {
  /** 标题（空标题为 ''） */
  title: string
  /** 链接：RSS <link> 文本或 Atom alternate <link href>；没有则为 '' */
  link: string
  /** RSS <guid> / Atom <id>（去重键优先用它） */
  guid?: string
  /** <enclosure url>（RSS）或 rel="enclosure" 的 Atom <link href> */
  enclosureUrl?: string
  /** <enclosure type> / Atom enclosure link 的 type 属性 */
  enclosureType?: string
  /** RSS <pubDate> / Atom <updated>（解析失败时回退 <published>） */
  publishedAt?: string
}

/** 解析结果 */
export interface ParsedFeed {
  /** 订阅源标题（取第一个 <item>/<entry> 之前的 <title>，即频道级标题） */
  title?: string
  /** 条目列表，上限 200；无法解析时为 [] */
  items: FeedItem[]
}

/** 条目数上限：正常订阅源远少于此，超量多半是异常输入（防日志/去重表被灌爆） */
const MAX_ITEMS = 200

/** XML 1.0 非法控制字符（保留 \t\n\r 三个合法空白符），混入正文会破坏后续正则匹配 */
// 控制字符类是刻意为之（洗 XML 就是本函数职责），关掉 no-control-regex
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

/** <item ...> 或 <entry ...> 起始标签（用于定位"频道头部"与条目分块） */
const ITEM_OR_ENTRY_START = /<(?:item|entry)(\s|>)/i

/**
 * 解析 RSS/Atom XML 文本。
 * 任何输入都不会抛异常：非字符串/空串/结构损坏一律返回 { items: [] }。
 */
export function parseFeed(xmlText: string): ParsedFeed {
  if (typeof xmlText !== 'string' || xmlText.length === 0) return { items: [] }
  try {
    // 先剔除控制字符：非法字符留在文本里会让下面的正则照常匹配出带脏数据的条目
    const xml = xmlText.replace(CONTROL_CHARS, '')
    return { title: extractFeedTitle(xml), items: extractItems(xml) }
  } catch {
    // 正则理论上不会抛，但防御性兜底：解析器绝不能成为 ticker 的崩溃源
    return { items: [] }
  }
}

/** 频道级标题 = 第一个条目之前出现的 <title>（RSS 频道标题 / Atom feed 标题） */
function extractFeedTitle(xml: string): string | undefined {
  const itemStart = xml.search(ITEM_OR_ENTRY_START)
  // 没有条目时整份文档都算"头部"；RDF 等变体的 <channel><title> 也在条目之前，同样能取到
  const head = itemStart >= 0 ? xml.slice(0, itemStart) : xml
  const match = head.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i)
  return match ? decodeText(match[1]) : undefined
}

/** 提取全部条目：文档含 <item> 走 RSS 2.0 路径，否则含 <entry> 走 Atom 路径 */
function extractItems(xml: string): FeedItem[] {
  const isAtom = !/<item(\s|>)/i.test(xml) && /<entry(\s|>)/i.test(xml)
  const tag = isAtom ? 'entry' : 'item'
  const itemRegex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'gi')
  const items: FeedItem[] = []
  for (const match of xml.matchAll(itemRegex)) {
    const body = match[1] ?? ''
    items.push(isAtom ? parseAtomEntry(body) : parseRssItem(body))
    if (items.length >= MAX_ITEMS) break // 超上限直接停止扫描，避免无谓的正则回溯
  }
  return items
}

/** 解析一个 RSS 2.0 <item> 内部 */
function parseRssItem(body: string): FeedItem {
  const title = firstTag(body, 'title')
  const link = firstTag(body, 'link')
  const guid = firstTag(body, 'guid')
  const publishedAt = firstTag(body, 'pubDate')
  const enclosure = body.match(/<enclosure(?:\s[^>]*)?>/i)
  return {
    title,
    link,
    ...(guid ? { guid } : {}),
    ...(enclosure ? enclosureFields(enclosure[0]) : {})
    // publishedAt 为空时不写该键，保持 FeedItem 的可选语义
    , ...(publishedAt ? { publishedAt } : {})
  }
}

/** 解析一个 Atom <entry> 内部 */
function parseAtomEntry(body: string): FeedItem {
  const title = firstTag(body, 'title')
  const guid = firstTag(body, 'id')
  const updated = firstTag(body, 'updated') || firstTag(body, 'published')
  // Atom 的链接都在 <link> 标签的属性上，语义由 rel 区分：
  // alternate（或缺省）是条目正文/下载地址，enclosure 是附件，self 是源自身（忽略）
  let link = ''
  let enclosureUrl: string | undefined
  let enclosureType: string | undefined
  for (const match of body.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0])
    const rel = attrs.rel?.toLowerCase()
    if (rel === 'enclosure') {
      enclosureUrl = attrs.href ?? enclosureUrl
      enclosureType = attrs.type ?? enclosureType
    } else if (!link && (rel === undefined || rel === 'alternate')) {
      link = attrs.href ?? ''
    }
  }
  return {
    title,
    link,
    ...(guid ? { guid } : {}),
    ...(enclosureUrl !== undefined ? { enclosureUrl } : {}),
    ...(enclosureType !== undefined ? { enclosureType } : {}),
    ...(updated ? { publishedAt: updated } : {})
  }
}

/** <enclosure url type> 的属性（RSS 专用附件声明） */
function enclosureFields(tag: string): { enclosureUrl?: string; enclosureType?: string } {
  const attrs = parseAttrs(tag)
  const fields: { enclosureUrl?: string; enclosureType?: string } = {}
  if (attrs.url) fields.enclosureUrl = attrs.url
  if (attrs.type) fields.enclosureType = attrs.type
  return fields
}

/** 取第一个 <name>...</name> 标签的解码文本；没有则返回 '' */
function firstTag(body: string, name: string): string {
  const match = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i'))
  return match ? decodeText(match[1]) : ''
}

/**
 * 标签属性提取：仅服务 feedParser 内部已知的标签名与属性名，
 * 不追求通用 XML 属性语义（单/双引号都认，属性值实体编码照常解码）。
 */
function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRegex = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of tag.matchAll(attrRegex)) {
    const name = match[1]
    // 同名属性重复时保留首个（XML 规范要求属性唯一，重复本身就是坏输入）
    if (name && !(name in attrs)) attrs[name] = decodeEntities(match[2] ?? match[3] ?? '')
  }
  return attrs
}

/** 元素文本解码：整段 CDATA 直接取内容，否则解码实体（两种写法不会混用于同一字段） */
function decodeText(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/)
  if (cdata) return (cdata[1] ?? '').trim()
  return decodeEntities(raw).trim()
}

/** 命名实体与数字实体解码（单趟替换，避免 &amp;lt; 这类双重转义被二次解码） */
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#[0-9]+|#[xX][0-9a-fA-F]+);/g, (raw, entity: string) => {
    switch (entity) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      default: {
        // 数字实体：捕获组已含前导 '#'（entity[0]），十六进制形如 '#x4F60'
        const code = entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return raw
        return String.fromCodePoint(code)
      }
    }
  })
}
