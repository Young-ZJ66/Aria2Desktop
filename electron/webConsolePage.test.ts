import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'

const { WEB_CONSOLE_HTML, WEB_CONSOLE_CSP } = await import('./webConsolePage')

/**
 * 页面把内联脚本/样式的内容哈希写死在 CSP 里（script-src 'sha256-…'）。
 * 一旦有人改了内联脚本却忘了同步哈希，浏览器会直接拒绝执行脚本——
 * 页面白屏、所有交互失效，而单测、typecheck、e2e 都不会发现（e2e 不加载 Web 控制台）。
 * 这组用例把「哈希必须与页面内容逐字节一致」变成可自动化的闸门。
 */

function inlineHashes(html: string, tag: 'script' | 'style'): string[] {
  const pattern = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'g')
  return [...html.matchAll(pattern)].map(
    (match) => 'sha256-' + createHash('sha256').update(match[1], 'utf8').digest('base64')
  )
}

function declaredHashes(csp: string): string[] {
  return [...csp.matchAll(/'sha256-[^']+'/g)].map((match) => match[0].replace(/'/g, ''))
}

describe('Web 控制台页面与 CSP', () => {
  it('内联脚本与样式的哈希都在 CSP 白名单里', () => {
    const scriptHashes = inlineHashes(WEB_CONSOLE_HTML, 'script')
    const styleHashes = inlineHashes(WEB_CONSOLE_HTML, 'style')
    expect(scriptHashes.length).toBeGreaterThan(0)
    expect(styleHashes.length).toBeGreaterThan(0)
    for (const hash of [...scriptHashes, ...styleHashes]) {
      expect(WEB_CONSOLE_CSP).toContain(hash)
    }
  })

  it('CSP 里没有与页面内容对不上的过期哈希', () => {
    const computed = [...inlineHashes(WEB_CONSOLE_HTML, 'script'), ...inlineHashes(WEB_CONSOLE_HTML, 'style')].sort()
    expect(declaredHashes(WEB_CONSOLE_CSP).sort()).toEqual(computed)
  })

  it('CSP 默认拒绝一切外部资源与嵌入', () => {
    expect(WEB_CONSOLE_CSP).toContain("default-src 'none'")
    expect(WEB_CONSOLE_CSP).toContain("frame-ancestors 'none'")
    expect(WEB_CONSOLE_CSP).toContain("base-uri 'none'")
    expect(WEB_CONSOLE_CSP).toContain("form-action 'none'")
    expect(WEB_CONSOLE_CSP).toContain("connect-src 'self'")
    expect(WEB_CONSOLE_CSP).toContain("img-src 'self' data:")
  })

  it('页面 meta 里的 CSP 与响应头逐字符一致', () => {
    const meta = WEB_CONSOLE_HTML.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)
    expect(meta).not.toBeNull()
    expect(meta![1]).toBe(WEB_CONSOLE_CSP)
  })

  it('页面没有内联事件处理器与 javascript: 链接', () => {
    expect(WEB_CONSOLE_HTML).not.toMatch(/\son[a-z]+\s*=/i)
    expect(WEB_CONSOLE_HTML).not.toContain('javascript:')
  })

  it('esc 转义 HTML 元字符，任务名与日志内容注入不了标签', () => {
    const match = WEB_CONSOLE_HTML.match(/function esc\(s\)\{([\s\S]*?)\}\nfunction fmtSize/)
    expect(match).not.toBeNull()
    const escapeHtml = new Function('s', match![1]) as (value: unknown) => string
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
    expect(escapeHtml('a&b"c\'d')).toBe('a&amp;b&quot;c&#39;d')
    expect(escapeHtml(null)).toBe('')
  })

  it('html lang 跟随实际界面语言，英文界面不再声明 zh-CN', () => {
    expect(WEB_CONSOLE_HTML).toContain('document.documentElement.lang')
  })
})
