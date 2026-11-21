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

  it('队列只读视图存在且不提供任何写操作', () => {
    expect(WEB_CONSOLE_HTML).toContain('id="queue"')
    expect(WEB_CONSOLE_HTML).toContain("api('/api/queue')")
    // 队列面板只渲染表格，不允许出现改并发/改重试的入口
    const start = WEB_CONSOLE_HTML.indexOf('队列（只读）')
    const section = WEB_CONSOLE_HTML.slice(start, WEB_CONSOLE_HTML.indexOf('id="tabs"'))
    expect(section.length).toBeGreaterThan(0)
    expect(section).not.toMatch(/<input|<select/)
    expect(section).not.toMatch(/data-act=/)
    // 表头与单元格都要带 data-label，否则移动端 @media 断点下会显示错乱
    expect(WEB_CONSOLE_HTML).toContain("data-label=\"'+L('位置','Position')+'\"")
  })

  it('内联脚本整体语法合法（改坏一个符号会让页面白屏且无其它闸门能发现）', () => {
    const script = WEB_CONSOLE_HTML.match(/<script>([\s\S]*?)<\/script>/)
    expect(script).not.toBeNull()
    expect(() => new Function(script![1])).not.toThrow()
    for (const name of ['queueRow', 'applyQueue', 'refreshQueue', 'renderTasks', 'applyStatus']) {
      expect(WEB_CONSOLE_HTML).toContain('function ' + name + '(')
    }
  })

  it('SSE 实时帧也会刷新队列面板，等待中的任务不会停在首屏快照', () => {
    // refresh() 里的 refreshQueue(true) 只覆盖首屏与手动刷新；
    // 若 SSE 的 status 分支不调 refreshQueue()，队列面板会一直显示旧快照，
    // 直到用户手动点刷新——这在新任务入队时表现为「队列里看不到刚排上的任务」。
    const branch = WEB_CONSOLE_HTML.match(/name==='status'&&data\)\{([\s\S]*?)\}\}\nfunction runAction/)
    expect(branch).not.toBeNull()
    expect(branch![1]).toContain('refreshQueue()')
    expect(branch![1]).not.toContain('refreshQueue(true)')
  })

  it('队列拉取失败后不会把签名预支掉，下一次仍会重新请求', () => {
    // 旧实现先写 queueSig=sig 再发请求：请求失败或还在飞的时候签名已被当成「已同步」，
    // 之后同签名的调用都直接复用旧缓存，队列面板会永久停在旧快照（新任务入队也看不见）。
    const match = WEB_CONSOLE_HTML.match(/function refreshQueue\(force\)\{([\s\S]*?)\}\nfunction renderTasks/)
    expect(match).not.toBeNull()
    const build = new Function(
      'queueSignature',
      'applyQueue',
      'api',
      'L',
      'qs',
      'state',
      'var queueSig = state.sig; var queueCache = state.cache; var queueFetchedAt = state.fetchedAt; var QUEUE_MAX_AGE_MS = 30000;\n' +
        'function refreshQueue(force){' + match![1] + '}\n' +
        'return { run: function(f){ refreshQueue(f) }, peek: function(){ return { sig: queueSig, cache: queueCache } } }'
    )
    const calls: string[] = []
    let failing = true
    const queueSignature = (): string => 'g1|g2'
    const api = (): Promise<unknown> => {
      calls.push('api')
      return failing ? Promise.reject(new Error('boom')) : Promise.resolve({ settings: {}, tasks: [], total: 0 })
    }
    const harness = build(queueSignature, () => {}, api, (zh: string) => zh, () => ({ textContent: '', innerHTML: '' }), {
      sig: null,
      cache: null,
      fetchedAt: 0
    } as { sig: string | null; cache: unknown; fetchedAt: number }) as {
      run: (force?: boolean) => void
      peek: () => { sig: string | null; cache: unknown }
    }

    harness.run()
    return Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        // 请求失败：签名不能被记住，缓存也保持空
        expect(calls).toHaveLength(1)
        expect(harness.peek().sig).toBeNull()
        expect(harness.peek().cache).toBeNull()
        // 同样的队列内容再次触发，必须重新拉取
        failing = false
        harness.run()
        return Promise.resolve().then(() => Promise.resolve())
      })
      .then(() => {
        expect(calls).toHaveLength(2)
        expect(harness.peek().sig).toBe('g1|g2')
        expect(harness.peek().cache).not.toBeNull()
        // 签名一致且已有缓存时才走本地缓存，不再发请求
        harness.run()
        expect(calls).toHaveLength(2)
      })
  })

  it('队列设置改了之后即使等待中的任务没变，超过 30 秒也会重新拉取', () => {
    // 签名只覆盖等待中的任务，桌面端改最大并发/重试策略不会改变签名，
    // 没有兜底重取的话网页端会一直显示旧设置。
    const match = WEB_CONSOLE_HTML.match(/function refreshQueue\(force\)\{([\s\S]*?)\}\nfunction renderTasks/)
    expect(match).not.toBeNull()
    const build = new Function(
      'queueSignature',
      'applyQueue',
      'api',
      'L',
      'qs',
      'state',
      'var queueSig = state.sig; var queueCache = state.cache; var queueFetchedAt = state.fetchedAt; var QUEUE_MAX_AGE_MS = 30000;\n' +
        'function refreshQueue(force){' + match![1] + '}\n' +
        'return { run: function(f){ refreshQueue(f) }, peek: function(){ return { sig: queueSig, cache: queueCache, fetchedAt: queueFetchedAt } }, expire: function(){ queueFetchedAt = Date.now() - 31000 } }'
    )
    let calls = 0
    const api = (): Promise<unknown> => {
      calls += 1
      return Promise.resolve({ settings: { maxConcurrent: 5 }, tasks: [], total: 0 })
    }
    const harness = build(
      () => 'g1',
      () => {},
      api,
      (zh: string) => zh,
      () => ({ textContent: '', innerHTML: '' }),
      { sig: null, cache: null, fetchedAt: 0 } as { sig: string | null; cache: unknown; fetchedAt: number }
    ) as {
      run: (force?: boolean) => void
      peek: () => { sig: string | null; cache: unknown; fetchedAt: number }
      expire: () => void
    }

    harness.run()
    return Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        expect(calls).toBe(1)
        // 刚拉过：同签名直接走缓存
        harness.run()
        expect(calls).toBe(1)
        // 缓存超过 30 秒：即使签名没变也要重新拉
        harness.expire()
        harness.run()
        return Promise.resolve().then(() => Promise.resolve())
      })
      .then(() => {
        expect(calls).toBe(2)
        expect(Date.now() - harness.peek().fetchedAt).toBeLessThan(30000)
      })
  })

  it('队列签名把任务状态也算进去，暂停/恢复后同一批任务仍会刷新面板', () => {
    // 只按 gid 算签名时，「同一个任务从 active 变成 paused」签名不变，
    // 面板会一直显示旧的状态徽标，直到 gid 集合本身发生变化。
    const match = WEB_CONSOLE_HTML.match(/function queueSignature\(data\)\{([\s\S]*?)\}\nfunction queueRow/)
    expect(match).not.toBeNull()
    const signature = new Function('data', 'lastStatus', match![1]) as (
      data: unknown,
      lastStatus: unknown
    ) => string
    const base = [{ gid: 'g1', status: 'active' }, { gid: 'g2', status: 'waiting' }]
    expect(signature({ waiting: base }, null)).not.toBe(signature({ waiting: [{ gid: 'g1', status: 'paused' }, base[1]] }, null))
    // 同一批 gid 且状态都没变时签名必须稳定，否则会退化成每次推送都重新拉队列
    expect(signature({ waiting: base }, null)).toBe(signature({ waiting: [...base] }, null))
    // 没有 waiting 字段时回落到 lastStatus
    expect(signature(undefined, { waiting: base })).toBe(signature({ waiting: base }, null))
  })

  it('html lang 跟随实际界面语言，英文界面不再声明 zh-CN', () => {
    expect(WEB_CONSOLE_HTML).toContain('document.documentElement.lang')
  })
  it('页面不再把令牌存进 localStorage，改用 HttpOnly 会话 Cookie（D-14）', () => {
    // 令牌存 localStorage 时任何 XSS 都能读走并长期复用；改成会话 Cookie 后
    // 脚本读不到（HttpOnly）、跨站请求也带不上（SameSite=Strict）。
    expect(WEB_CONSOLE_HTML).not.toContain('aria2web_token')
    expect(WEB_CONSOLE_HTML).not.toContain('localStorage.setItem(\'aria2web_token\'')
    expect(WEB_CONSOLE_HTML).toContain("api('/api/session'")
    expect(WEB_CONSOLE_HTML).toContain("credentials='same-origin'")
    // 页面脚本里不能再拼 Authorization 头（令牌已不在页面内存里）
    expect(WEB_CONSOLE_HTML).not.toContain("'Bearer '+token")
    expect(WEB_CONSOLE_HTML).not.toMatch(/Authorization/ )
  })

  it('退出登录会调用 DELETE /api/session 让服务端清掉会话', () => {
    const logout = WEB_CONSOLE_HTML.match(/function logout\(\)\{([\s\S]*?)\n/)
    expect(logout).not.toBeNull()
    expect(logout![1]).toContain("'/api/session'")
    expect(logout![1]).toContain("method:'DELETE'")
  })
})
