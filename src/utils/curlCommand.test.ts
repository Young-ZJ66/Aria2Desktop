import { describe, expect, it } from 'vitest'
import { parseCurlCommand, tokenizeCurlCommand } from './curlCommand'

describe('tokenizeCurlCommand', () => {
  it('支持单引号、双引号与反斜杠续行', () => {
    const tokens = tokenizeCurlCommand("curl 'https://example.com/a.zip' \\\n  -H 'Referer: https://example.com'")
    expect(tokens).toEqual(['curl', 'https://example.com/a.zip', '-H', 'Referer: https://example.com'])
  })
})

describe('parseCurlCommand', () => {
  it('提取 URL、请求头、Cookie 与文件名', () => {
    const result = parseCurlCommand(
      `curl 'https://example.com/file.zip' -H 'Referer: https://example.com/page' -H 'User-Agent: Mozilla/5.0' -b 'sid=1' -o 'file.zip'`
    )
    expect(result).toEqual({
      url: 'https://example.com/file.zip',
      headers: {
        Referer: 'https://example.com/page',
        'User-Agent': 'Mozilla/5.0'
      },
      referer: 'https://example.com/page',
      userAgent: 'Mozilla/5.0',
      cookie: 'sid=1',
      fileName: 'file.zip'
    })
  })

  it('支持 --url 与 Windows ^ 续行', () => {
    const result = parseCurlCommand('curl --url "https://example.com/a" ^\n  -H "Cookie: a=1"')
    expect(result?.url).toBe('https://example.com/a')
    expect(result?.cookie).toBe('a=1')
  })

  it('非 cURL 命令返回 null', () => {
    expect(parseCurlCommand('https://example.com/a.zip')).toBeNull()
    expect(parseCurlCommand('curl -H "X: 1"')).toBeNull()
  })
})
