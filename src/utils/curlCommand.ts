/**
 * 解析浏览器「Copy as cURL」命令（下载页高级选项用）。
 *
 * 只提取下载需要的部分：URL、请求头、Referer、User-Agent、Cookie、文件名。
 * 支持 Bash 的反斜杠续行与 Windows 终端的 ^ 续行；不执行任何命令。
 */

export interface ParsedCurl {
  url: string
  headers: Record<string, string>
  referer: string
  userAgent: string
  cookie: string
  fileName: string
}

const URL_PATTERN = /^(https?|ftp|sftp):\/\//i

/**
 * 这些标志后面跟着一个值；其中数据体（--data* / -F）里常常出现
 * `https://...`（表单跳转、JSON 接口），不吞掉的话会被当成下载 URL。
 */
const VALUE_FLAGS = new Set([
  '-d',
  '--data',
  '--data-raw',
  '--data-urlencode',
  '--data-binary',
  '--data-ascii',
  '-F',
  '--form',
  '--form-string',
  '-X',
  '--request',
  '-u',
  '--user',
  '-x',
  '--proxy',
  '--proxy-user',
  '-m',
  '--max-time',
  '--connect-timeout',
  '--retry',
  '-r',
  '--range',
  '-T',
  '--upload-file',
  '-E',
  '--cert',
  '--key',
  '--cacert',
  '--json'
])

/** 类 shell 分词：支持单/双引号与反斜杠转义 */
export function tokenizeCurlCommand(command: string): string[] {
  const normalized = command
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]!
    if (quote) {
      if (char === quote) {
        quote = null
      } else if (quote === '"' && char === '\\' && i + 1 < normalized.length) {
        // bash/cmd 在双引号内都只把 \" \\ \$ \` 当转义；`\U` 这类保持原样，
        // 否则 Windows 路径会被吃掉反斜杠（`C:\Users` → `C:Users`）
        const escaped = normalized[i + 1]!
        if (escaped === '\\' || escaped === '"' || escaped === '$' || escaped === '`') {
          current += escaped
          i += 1
        } else {
          current += char
        }
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '\\' && i + 1 < normalized.length) {
      current += normalized[++i]
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

/**
 * 解析 cURL 命令；不是 cURL 或找不到 URL 时返回 null。
 */
export function parseCurlCommand(command: string): ParsedCurl | null {
  const trimmed = command.trim()
  if (!/^curl(\s|$)/i.test(trimmed)) return null

  const tokens = tokenizeCurlCommand(trimmed)
  if (tokens.length < 2) return null

  let url = ''
  let referer = ''
  let userAgent = ''
  let cookie = ''
  let fileName = ''
  const headers: Record<string, string> = {}

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!
    const next = (): string => {
      i += 1
      return tokens[i] ?? ''
    }

    if (VALUE_FLAGS.has(token)) {
      // 已知带值但不用于下载的标志（数据体、认证、代理、超时…），连同值一起跳过
      next()
      continue
    }

    if (token === '-H' || token === '--header') {
      const header = next()
      const colon = header.indexOf(':')
      if (colon > 0) {
        const name = header.slice(0, colon).trim()
        const value = header.slice(colon + 1).trim()
        if (name) {
          headers[name] = value
          if (/^referer$/i.test(name)) referer = value
          else if (/^user-agent$/i.test(name)) userAgent = value
          else if (/^cookie$/i.test(name)) cookie = value
        }
      }
      continue
    }
    if (token === '-b' || token === '--cookie') {
      cookie = next()
      continue
    }
    if (token === '-e' || token === '--referer') {
      referer = next()
      continue
    }
    if (token === '-A' || token === '--user-agent') {
      userAgent = next()
      continue
    }
    if (token === '-o' || token === '--output') {
      fileName = next()
      continue
    }
    if (token === '--url') {
      const value = next()
      if (URL_PATTERN.test(value)) url = value
      continue
    }
    if (!url && URL_PATTERN.test(token)) url = token
  }

  if (!url) return null
  return { url, headers, referer, userAgent, cookie, fileName }
}
