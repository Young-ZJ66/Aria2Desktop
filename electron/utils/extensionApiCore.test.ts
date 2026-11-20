import { describe, expect, it } from 'vitest'
import {
  EXTENSION_ID,
  EXTENSION_TOKEN_PREFIX,
  createExtensionToken,
  extensionIdFromOrigin,
  hasExtensionScope,
  isAllowedDownloadUri,
  isAuthorizedExtensionRequest,
  isAuthorizedExtensionRequestWithToken,
  isExtensionOrigin,
  isExtensionTokenFormat,
  isPlainFileName,
  isPlaylistUri,
  isProbeAllowed,
  normalizeExtensionVersionHeader,
  normalizeTokenScopes,
  parseRequestPathname,
  sanitizeDownloadFileName,
  sanitizeExtensionName,
  sanitizeRequestHeaders,
  type ExtensionTokenRecord,
  type ExtensionTokenScope
} from './extensionApiCore'

/**
 * 本地接口的鉴权是这个功能唯一的攻击面，边界必须逐条钉死：
 * 密钥缺失/错误、来源非法、scheme 大小写、前缀伪装（chrome-extension.evil.com）等。
 */
const SECRET = 'test-secret-1234567890'

describe('isAuthorizedExtensionRequest', () => {
  it('未配置密钥时一律拒绝（没有密钥就没有鉴权手段）', () => {
    expect(isAuthorizedExtensionRequest({
      authorization: `Bearer ${SECRET}`,
      origin: `chrome-extension://${EXTENSION_ID}`,
      secret: ''
    })).toBe(false)
  })

  it('缺少 Authorization 时拒绝', () => {
    expect(isAuthorizedExtensionRequest({ authorization: undefined, origin: undefined, secret: SECRET })).toBe(false)
  })

  it('密钥不匹配时拒绝', () => {
    expect(isAuthorizedExtensionRequest({
      authorization: 'Bearer wrong-secret',
      origin: `chrome-extension://${EXTENSION_ID}`,
      secret: SECRET
    })).toBe(false)
  })

  it('密钥正确且来源为扩展时放行（ID 不写死，兼容开发态安装）', () => {
    expect(isAuthorizedExtensionRequest({
      authorization: `Bearer ${SECRET}`,
      origin: `chrome-extension://${EXTENSION_ID}`,
      secret: SECRET
    })).toBe(true)
    // 「加载已解压」安装的 ID 由目录路径派生，与签名 crx 不同，也必须可用
    expect(isAuthorizedExtensionRequest({
      authorization: `Bearer ${SECRET}`,
      origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      secret: SECRET
    })).toBe(true)
  })

  it('非浏览器客户端（无 Origin）凭密钥放行，便于 curl 排障', () => {
    expect(isAuthorizedExtensionRequest({
      authorization: `Bearer ${SECRET}`,
      origin: undefined,
      secret: SECRET
    })).toBe(true)
  })

  it('网页来源一律拒绝（即便密钥正确）', () => {
    for (const origin of [
      'http://localhost:6801',
      'https://evil.example.com',
      'null',
      'file://'
    ]) {
      expect(isAuthorizedExtensionRequest({ authorization: `Bearer ${SECRET}`, origin, secret: SECRET })).toBe(false)
    }
  })

  it('拒绝域名伪装成扩展源（前缀必须完整匹配 chrome-extension://）', () => {
    for (const origin of [
      'https://chrome-extension.evil.com',
      'chrome-extension.evil.com',
      'chrome-extension:/x',
      ' chrome-extension://abc'
    ]) {
      expect(isAuthorizedExtensionRequest({ authorization: `Bearer ${SECRET}`, origin, secret: SECRET })).toBe(false)
    }
  })

  it('scheme 大小写不敏感，但 token 必须完全相同', () => {
    expect(isAuthorizedExtensionRequest({
      authorization: `bearer ${SECRET}`,
      origin: undefined,
      secret: SECRET
    })).toBe(true)
    expect(isAuthorizedExtensionRequest({
      authorization: `Bearer ${SECRET} `,
      origin: undefined,
      secret: SECRET
    })).toBe(false)
  })

  it('畸形 Authorization 头不会抛错（空串/多段/仅 scheme）', () => {
    for (const authorization of ['', 'Bearer', `Bearer ${SECRET} extra`, 'Basic abc']) {
      expect(isAuthorizedExtensionRequest({ authorization, origin: undefined, secret: SECRET })).toBe(false)
    }
  })
})

describe('isAllowedDownloadUri', () => {
  it('放行 aria2 支持的下载协议（含大写与 magnet）', () => {
    for (const url of [
      'http://example.com/a.zip',
      'HTTPS://example.com/a.zip',
      'ftp://example.com/a.zip',
      'sftp://example.com/a.zip',
      'magnet:?xt=urn:btih:abcdef'
    ]) {
      expect(isAllowedDownloadUri(url)).toBe(true)
    }
  })

  it('拒绝本地与脚本协议、空串、畸形输入', () => {
    for (const url of [
      '',
      '   ',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'chrome-extension://abc/x',
      'not a url',
      '/etc/passwd'
    ]) {
      expect(isAllowedDownloadUri(url)).toBe(false)
    }
  })
})

describe('isProbeAllowed（探测的 SSRF 边界）', () => {
  it('放行公网与局域网地址（局域网下载是正当场景，不能挡）', () => {
    for (const url of [
      'https://example.com/a',
      'https://d.pcs.baidu.com/file/xxx',
      'http://192.168.1.10:5000/download?id=42',
      'http://10.0.0.8/a.zip',
      'http://172.16.5.4/a.zip',
      'https://nas.local/a'
    ]) {
      expect(isProbeAllowed(url)).toBe(true)
    }
  })

  it('挡住回环、链路本地（含云元数据）、CGNAT 与 .localhost', () => {
    for (const url of [
      'http://127.0.0.1:9999/whatever',
      'http://localhost:6800/file',
      'http://x.localhost/file',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/a',
      'http://100.64.0.1/a',
      'http://[::1]:8080/a'
    ]) {
      expect(isProbeAllowed(url)).toBe(false)
    }
  })

  it('非 http(s) 与畸形输入不探测', () => {
    for (const url of ['magnet:?xt=urn:btih:abc', 'ftp://example.com/a.zip', 'not a url', '']) {
      expect(isProbeAllowed(url)).toBe(false)
    }
  })
})

describe('isExtensionOrigin（配对来源校验——唯一免密端点，来源必须从严）', () => {
  it('合法的扩展 Origin → true（返回布尔：来源字符串到此为止，不流向任何下游）', () => {
    expect(isExtensionOrigin(`chrome-extension://${EXTENSION_ID}`)).toBe(true)
  })

  it('空 Origin、网页来源、伪装域名、畸形输入 → 一律拒绝', () => {
    for (const origin of [
      undefined,
      '',
      'https://evil.example.com',
      'http://localhost:6801',
      'null',
      'chrome-extension.evil.com',
      'chrome-extension://abc',           // ID 不完整
      'chrome-extension://ABCDEFABCDEFABCDEFABCDEFABCDEFAB', // 非 a-p 字符（大写）
      'chrome-extension://ndikflbmajhflfndbjblihkifnfbmdon/x', // 带路径
      ' chrome-extension://ndikflbmajhflfndbjblihkifnfbmdon'   // 前导空格
    ]) {
      expect(isExtensionOrigin(origin)).toBe(false)
    }
  })
})

/**
 * 该值会被当作 aria2 的 `out` 下发（`out` 与 `dir` 同属注入面），
 * 判错一次的后果是"能往下载目录之外写文件"——已用 aria2c 实测：
 * `out=../escape.txt` 会在上级目录生成文件，`out=C:\...\x.zip` 则 errorCode=18 直接失败。
 */
describe('sanitizeDownloadFileName（out 的注入面防线）', () => {
  it('目录穿越被收敛为纯文件名', () => {
    expect(sanitizeDownloadFileName('../escape.txt')).toBe('escape.txt')
    expect(sanitizeDownloadFileName('..\\..\\Windows\\evil.exe')).toBe('evil.exe')
    expect(sanitizeDownloadFileName('/etc/passwd')).toBe('passwd')
    expect(sanitizeDownloadFileName('a/b/../../c.zip')).toBe('c.zip')
  })

  it('Windows 绝对路径只保留文件名（扩展拦截下载给的就是这种）', () => {
    expect(sanitizeDownloadFileName('C:\\Users\\YoungZJ\\Downloads\\video.mp4')).toBe('video.mp4')
    expect(sanitizeDownloadFileName('D:/Downloads/子目录/report.pdf')).toBe('report.pdf')
  })

  it('剔除 Windows 非法字符与控制符', () => {
    expect(sanitizeDownloadFileName('a<b>c:d"e|f?g*h.txt')).toBe('abcdefgh.txt')
    expect(sanitizeDownloadFileName('bad\u0000name.txt')).toBe('badname.txt')
  })

  it('目录项与空结果一律拒绝（返回空串，调用方回落到 URL 命名）', () => {
    for (const input of ['.', '..', '  ', '', '/', '\\\\', '../../../', null, undefined, 42, {}]) {
      expect(sanitizeDownloadFileName(input)).toBe('')
    }
  })

  it('正常文件名（含中文、空格、多后缀）原样保留', () => {
    expect(sanitizeDownloadFileName('我的 视频.tar.gz')).toBe('我的 视频.tar.gz')
    expect(sanitizeDownloadFileName('  padded.txt  ')).toBe('padded.txt')
  })
})

describe('isPlainFileName（下发 out 前的二次断言）', () => {
  it('只有已净化的纯文件名通过', () => {
    expect(isPlainFileName('video.mp4')).toBe(true)
    expect(isPlainFileName('C:\\Users\\x\\video.mp4')).toBe(false)
    expect(isPlainFileName('../escape.txt')).toBe(false)
    expect(isPlainFileName('sub/dir/file.txt')).toBe(false)
    expect(isPlainFileName('')).toBe(false)
  })
})

/**
 * 请求头会被原样作为 aria2 的 `header` / `user-agent` / `referer` 下发，
 * 因此这里就是"扩展能往下载请求里塞什么"的唯一闸门：
 * CR/LF 必须整条拒绝（请求拆分），逐跳头必须剔除（改 Host 会连到别的主机）。
 */
describe('sanitizeRequestHeaders（下发请求头前的净化）', () => {
  it('普通头归一为小写名称，user-agent / referer 提升为专用字段', () => {
    expect(sanitizeRequestHeaders([
      'Cookie: a=1; b=2',
      'Referer: https://example.com/page',
      'User-Agent: Mozilla/5.0 Test',
      'Accept-Language: zh-CN,zh;q=0.9'
    ])).toEqual({
      header: ['cookie: a=1; b=2', 'accept-language: zh-CN,zh;q=0.9'],
      userAgent: 'Mozilla/5.0 Test',
      referer: 'https://example.com/page'
    })
  })

  it('含 CR/LF 的条目整条丢弃（防请求拆分）', () => {
    const result = sanitizeRequestHeaders([
      'X-A: 1\r\nCookie: stolen=1',
      'X-B: 2\nInjected: 1',
      'X-Ok: fine'
    ])
    expect(result.header).toEqual(['x-ok: fine'])
  })

  it('含其他控制字符（NUL/VT/DEL）的条目整条丢弃', () => {
    const result = sanitizeRequestHeaders([
      'X-A: 1\u0000evil',
      'X-B: 2\u000b',
      'X-C: 3\u007f',
      'X-Ok: fine'
    ])
    expect(result.header).toEqual(['x-ok: fine'])
  })

  it('逐跳头与长度相关头一律剔除（Host 被改写会连到非目标主机）', () => {
    const result = sanitizeRequestHeaders([
      'Host: evil.example.com',
      'Content-Length: 0',
      'Transfer-Encoding: chunked',
      'Connection: keep-alive',
      'Cookie: keep=1'
    ])
    expect(result.header).toEqual(['cookie: keep=1'])
  })

  it('非法名称、空值、非字符串项、无冒号项一律丢弃', () => {
    const result = sanitizeRequestHeaders([
      'Bad Name: x',
      'X-Empty:   ',
      'no-colon-here',
      'X-Space:，中文值',
      42,
      null
    ])
    // 中文值合法（HTTP/1.1 头值本应为 ASCII/latin1，但 aria2 会按字节透传，不做额外限制）
    expect(result.header).toEqual(['x-space: ，中文值'])
  })

  it('referer 只接受 http(s) 绝对地址', () => {
    expect(sanitizeRequestHeaders(['Referer: javascript:alert(1)']).referer).toBe('')
    expect(sanitizeRequestHeaders(['Referer: file:///C:/x']).referer).toBe('')
    expect(sanitizeRequestHeaders(['Referer: not a url']).referer).toBe('')
    expect(sanitizeRequestHeaders(['Referer: http://localhost:8080/a']).referer).toBe('http://localhost:8080/a')
  })

  it('非数组输入返回空结果（接口不信任调用方类型）', () => {
    for (const input of [undefined, null, '', 'Cookie: a=1', 42, { header: ['a: b'] }]) {
      expect(sanitizeRequestHeaders(input)).toEqual({ header: [], userAgent: '', referer: '' })
    }
  })

  it('超长与超量输入被截断（接口不能被当作数据通道）', () => {
    const longValue = `X-Long: ${'a'.repeat(5000)}`
    expect(sanitizeRequestHeaders([longValue]).header).toEqual([])

    const many = Array.from({ length: 40 }, (_, i) => `X-${i}: v`)
    expect(sanitizeRequestHeaders(many).header).toHaveLength(24)
  })
})

/**
 * 回归用例：以下请求目标都会让 new URL 抛 TypeError，而解析发生在鉴权**之前**、
 * 异常又没人 catch → 一条畸形请求即可让主进程按 Node 默认策略退出（无需密钥）。
 * 其中 `//` 尤其危险：它是最普通的 origin-form 目标，浏览器/curl 随手就能发出。
 * 现在解析结果统一收敛为 null（调用方回 400），本用例保证不会退化。
 */
describe('parseRequestPathname（畸形请求目标不得抛错）', () => {
  it('会让 new URL 抛错的畸形目标 → 返回 null', () => {
    for (const target of ['//', 'http://[', '//[', 'http://[::1', 'https://[abc/']) {
      // 前提校验：这些输入确实会让裸 new URL 抛错（否则本用例失去意义）
      expect(() => new URL(target, 'http://127.0.0.1')).toThrow()
      expect(parseRequestPathname(target)).toBeNull()
    }
  })

  it('正常与空输入 → 返回 pathname', () => {
    expect(parseRequestPathname('/api/status')).toBe('/api/status')
    expect(parseRequestPathname('/api/add?x=1')).toBe('/api/add')
    expect(parseRequestPathname(undefined)).toBe('/')
    expect(parseRequestPathname('')).toBe('/')
  })
})

/**
 * ── D-06：受限 token ──────────────────────────────────────────────
 *
 * 配对后扩展手里**不再有 RPC 密钥**，只有一枚带 scope 的 token。
 * 这些用例钉住三件事：token 不可猜（格式/随机性）、scope 是白名单而非黑名单、
 * 旧的手填密钥路径仍然可用（老用户配置不能失效）。
 */
const TOKEN_EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
const TOKEN_ORIGIN = `chrome-extension://${TOKEN_EXT_ID}`

function recordOf(token: string, scopes: ExtensionTokenScope[]): ExtensionTokenRecord {
  return {
    token,
    scopes,
    extensionId: TOKEN_EXT_ID,
    extensionName: 'probe',
    origin: TOKEN_ORIGIN,
    createdAt: Date.now()
  }
}

describe('createExtensionToken / isExtensionTokenFormat', () => {
  it('生成的 token 带 ext_ 前缀、长度固定且每次不同', () => {
    const a = createExtensionToken()
    const b = createExtensionToken()
    expect(a.startsWith(EXTENSION_TOKEN_PREFIX)).toBe(true)
    expect(a).toHaveLength(EXTENSION_TOKEN_PREFIX.length + 43)
    expect(a).not.toBe(b)
    expect(isExtensionTokenFormat(a)).toBe(true)
  })

  it('非 token 形态一律不认（含 RPC 密钥、截断值、错误前缀）', () => {
    for (const value of ['', 'ext_', 'ext_short', `ext_${'a'.repeat(44)}`, SECRET, null, 42, {}]) {
      expect(isExtensionTokenFormat(value)).toBe(false)
    }
  })
})

describe('normalizeTokenScopes / hasExtensionScope', () => {
  it('只保留已知 scope，去重并按固定顺序排列', () => {
    expect(normalizeTokenScopes(['tasks:read', 'tasks:read', 'admin', 42, 'download:add']))
      .toEqual(['download:add', 'tasks:read'])
  })

  it('非数组输入返回空数组（不做隐式放行）', () => {
    for (const input of [undefined, null, 'tasks:read', {}, 1]) {
      expect(normalizeTokenScopes(input)).toEqual([])
    }
  })

  it('scope 是白名单：未授予即为 false', () => {
    expect(hasExtensionScope(['tasks:read'], 'tasks:read')).toBe(true)
    expect(hasExtensionScope(['tasks:read'], 'download:add')).toBe(false)
    expect(hasExtensionScope([], 'download:add')).toBe(false)
    expect(hasExtensionScope(undefined, 'download:add')).toBe(false)
  })
})

describe('extensionIdFromOrigin / sanitizeExtensionName', () => {
  it('chromium 32 位 ID 与 firefox UUID 都能取出', () => {
    expect(extensionIdFromOrigin(TOKEN_ORIGIN)).toBe(TOKEN_EXT_ID)
    expect(extensionIdFromOrigin('moz-extension://11111111-2222-3333-4444-555555555555'))
      .toBe('11111111-2222-3333-4444-555555555555')
  })

  it('非法来源返回空串（不做宽松解析）', () => {
    for (const origin of ['', 'https://evil.example.com', 'chrome-extension://short', undefined]) {
      expect(extensionIdFromOrigin(origin)).toBe('')
    }
  })

  it('名称净化：控制字符转空格、压缩空白、截断 64 字符', () => {
    expect(sanitizeExtensionName('  Aria2\n\t扩展  ')).toBe('Aria2 扩展')
    expect(sanitizeExtensionName('a'.repeat(100))).toHaveLength(64)
    expect(sanitizeExtensionName(undefined)).toBe('')
    expect(sanitizeExtensionName({ name: 'x' })).toBe('')
  })

  it('名称里的换行不能伪造出"多行弹窗"', () => {
    // 原生对话框按 \n 分行：请求侧数据必须先把换行压平
    expect(sanitizeExtensionName('真扩展\n\n警告：请点允许')).not.toContain('\n')
  })
})

describe('normalizeExtensionVersionHeader', () => {
  it('接受 1~4 段数字版本', () => {
    expect(normalizeExtensionVersionHeader('1.4.0')).toBe('1.4.0')
    expect(normalizeExtensionVersionHeader(' 1 ')).toBe('1')
    expect(normalizeExtensionVersionHeader('1.2.3.4')).toBe('1.2.3.4')
  })

  it('非法版本一律空串（不原样回显到对话框）', () => {
    for (const value of ['', 'v1.4.0', '1.4.0-beta', '1.2.3.4.5', undefined, '1..2']) {
      expect(normalizeExtensionVersionHeader(value as string | undefined)).toBe('')
    }
  })
})

describe('isAuthorizedExtensionRequestWithToken', () => {
  const token = createExtensionToken()

  it('token 命中 → via=token 且带上 scope', () => {
    const auth = isAuthorizedExtensionRequestWithToken({
      authorization: `Bearer ${token}`,
      origin: TOKEN_ORIGIN,
      secret: SECRET,
      tokens: [recordOf(token, ['tasks:read'])]
    })
    expect(auth.ok).toBe(true)
    expect(auth.via).toBe('token')
    expect(auth.scopes).toEqual(['tasks:read'])
    expect(auth.record?.extensionId).toBe(TOKEN_EXT_ID)
  })

  it('token 未命中但密钥正确 → via=secret、scopes=null（等价全权，旧配置兼容）', () => {
    const auth = isAuthorizedExtensionRequestWithToken({
      authorization: `Bearer ${SECRET}`,
      origin: TOKEN_ORIGIN,
      secret: SECRET,
      tokens: [recordOf(token, ['tasks:read'])]
    })
    expect(auth.ok).toBe(true)
    expect(auth.via).toBe('secret')
    expect(auth.scopes).toBeNull()
  })

  it('网页来源即便拿着正确 token 也拒绝', () => {
    expect(isAuthorizedExtensionRequestWithToken({
      authorization: `Bearer ${token}`,
      origin: 'https://evil.example.com',
      secret: SECRET,
      tokens: [recordOf(token, ['tasks:read'])]
    }).ok).toBe(false)
  })

  it('缺 Authorization / 非 Bearer / 多段 → 拒绝', () => {
    for (const authorization of [undefined, '', 'Bearer', `Basic ${token}`, `Bearer ${token} extra`]) {
      expect(isAuthorizedExtensionRequestWithToken({
        authorization,
        origin: TOKEN_ORIGIN,
        secret: SECRET,
        tokens: [recordOf(token, ['tasks:read'])]
      }).ok).toBe(false)
    }
  })

  it('撤销后（tokens 为空）且没有密钥 → 拒绝', () => {
    expect(isAuthorizedExtensionRequestWithToken({
      authorization: `Bearer ${token}`,
      origin: TOKEN_ORIGIN,
      secret: '',
      tokens: []
    }).ok).toBe(false)
  })
})

describe('isPlaylistUri（D-07）', () => {
  it('m3u8 / mpd 识别为播放列表（含查询串、大小写、编码）', () => {
    expect(isPlaylistUri('https://cdn.example.com/live/index.m3u8')).toBe(true)
    expect(isPlaylistUri('https://cdn.example.com/live/index.M3U8?token=abc')).toBe(true)
    expect(isPlaylistUri('https://cdn.example.com/dash/manifest.mpd#t=10')).toBe(true)
    expect(isPlaylistUri('https://cdn.example.com/a/b%2Fc.m3u8')).toBe(true)
  })

  it('普通媒体文件与分片不算播放列表', () => {
    for (const url of [
      'https://cdn.example.com/v.mp4',
      'https://cdn.example.com/seg-1.ts',
      'https://cdn.example.com/seg-1.m4s',
      'https://cdn.example.com/playlist', // 无扩展名
      'https://cdn.example.com/x.m3u8x'
    ]) {
      expect(isPlaylistUri(url)).toBe(false)
    }
  })

  it('非法输入不抛错', () => {
    for (const url of ['', 'not a url', 'magnet:?xt=urn:btih:abc', undefined as unknown as string]) {
      expect(isPlaylistUri(url)).toBe(false)
    }
  })
})

