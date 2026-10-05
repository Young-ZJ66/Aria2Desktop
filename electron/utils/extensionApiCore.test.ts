import { describe, expect, it } from 'vitest'
import {
  EXTENSION_ID,
  getPairingExtensionId,
  isAllowedDownloadUri,
  isAuthorizedExtensionRequest,
  isPlainFileName,
  isProbeAllowed,
  parseRequestPathname,
  sanitizeDownloadFileName
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

describe('getPairingExtensionId（配对来源校验——唯一免密端点，来源必须从严）', () => {
  it('合法的扩展 Origin → 返回扩展 ID', () => {
    expect(getPairingExtensionId(`chrome-extension://${EXTENSION_ID}`)).toBe(EXTENSION_ID)
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
      expect(getPairingExtensionId(origin)).toBeNull()
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
