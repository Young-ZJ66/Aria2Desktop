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

  it('单引号内反斜杠原样保留', () => {
    expect(tokenizeCurlCommand(`'C:\\Users\\me'`)).toEqual(['C:\\Users\\me'])
  })

  it('双引号内保留非转义反斜杠（Windows 路径不被吃掉）', () => {
    expect(tokenizeCurlCommand(`"C:\\Users\\me\\file.zip"`)).toEqual(['C:\\Users\\me\\file.zip'])
  })

  it('双引号内 \\" 与 \\\\ 仍是转义', () => {
    expect(tokenizeCurlCommand('"a\\"b\\\\c"')).toEqual(['a"b\\c'])
  })

  it('未闭合的引号不崩溃', () => {
    expect(tokenizeCurlCommand(`curl 'http://x`)).toEqual(['curl', 'http://x'])
  })

  it('回归：POST 数据体里的 URL 不会被当成下载地址', () => {
    const parsed = parseCurlCommand(
      `curl 'https://api.example.com/v1/resolve' -X POST --data-raw '{"redirect":"https://evil.example/file.mp4"}'`
    )
    expect(parsed!.url).toBe('https://api.example.com/v1/resolve')
    expect(parsed!.url).not.toContain('evil.example')
  })

  it('回归：-d / -F 的值也不会被误认成 URL', () => {
    expect(parseCurlCommand(`curl http://real/x -d 'https://body.example/f'`)!.url).toBe('http://real/x')
    expect(parseCurlCommand(`curl http://real/x -F 'r=https://body.example/f'`)!.url).toBe('http://real/x')
  })

  it('回归：-o 的 Windows 路径保留反斜杠', () => {
    const parsed = parseCurlCommand(`curl http://x/a.zip -o "C:\\Users\\me\\a.zip"`)
    expect(parsed!.fileName).toBe('C:\\Users\\me\\a.zip')
  })

  it('重复的 -H 后者覆盖前者', () => {
    const parsed = parseCurlCommand(`curl http://x -H 'X: 1' -H 'X: 2'`)
    expect(parsed!.headers['X']).toBe('2')
  })
})
