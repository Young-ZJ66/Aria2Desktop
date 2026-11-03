/**
 * getUserFriendlyError 的映射测试。
 *
 * 所有用户可见的错误提示都经过这里；映射顺序与兜底行为一旦回归，
 * 用户就会看到 "ECONNREFUSED 127.0.0.1" 这类原文。
 * i18n 被替换成回显 key 的假实现，断言只关心"命中了哪个 key"。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({
  default: {
    global: {
      t: (key: string) => `<${key}>`
    }
  }
}))

import { getUserFriendlyError } from './errorMessages'

describe('getUserFriendlyError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['connect ECONNREFUSED 127.0.0.1:6800', 'errors.econnrefused'],
    ['read ECONNRESET', 'errors.econnreset'],
    ['request ETIMEDOUT', 'errors.etimedout'],
    ['getaddrinfo ENOTFOUND github.com', 'errors.enotfound'],
    ['connect EHOSTUNREACH 1.2.3.4:443', 'errors.ehostunreach'],
    ['Error: socket hang up', 'errors.socketHangUp'],
    ['Timeout of 30000ms exceeded', 'errors.timeout'],
    ['WebSocket connection closed unexpectedly', 'errors.wsClosed'],
    ['Aria2 RPC Error: Unauthorized', 'errors.rpcError'],
    ['GID abc123 not found', 'errors.gidNotFound'],
    ['not acceptable option: max-piece-length', 'errors.unsupportedOption'],
    ['ENOENT: no such file or directory', 'errors.enoent'],
    ['EACCES: permission denied', 'errors.eacces'],
    ['EPERM: operation not permitted', 'errors.eperm'],
    ['EBUSY: resource busy or locked', 'errors.ebusy'],
    ['ENOSPC: no space left on device', 'errors.enospc'],
    ['Path outside allowed directory', 'errors.pathOutsideAllowed'],
    ['No URIs found', 'errors.noUris'],
    ['Too many redirects', 'errors.tooManyRedirects']
  ])('%s -> %s', (raw, expected) => {
    expect(getUserFriendlyError(new Error(raw))).toBe(`<${expected}>`)
  })

  it('TLS/代理/证书类错误命中专门提示（v1.2.1 实测发现 SSL handshake 只落到兜底）', () => {
    // 实测原文："SSL/TLS handshake failure: Error: 远程主机强迫关闭了一个现有的连接。 (2746)"
    expect(getUserFriendlyError(new Error('SSL/TLS handshake failure: Error: 远程主机强迫关闭了一个现有的连接。 (2746)'))).toBe('<errors.tlsHandshake>')
    expect(getUserFriendlyError(new Error('TLS handshake timeout'))).toBe('<errors.tlsHandshake>')
    expect(getUserFriendlyError(new Error('net::ERR_PROXY_CONNECTION_FAILED'))).toBe('<errors.proxy>')
    expect(getUserFriendlyError(new Error('self signed certificate in certificate chain'))).toBe('<errors.certificate>')
  })

  it('TLS 模式优先于 ECONNRESET 的泛化文案（握手失败常伴随连接被远端关闭）', () => {
    const raw = 'SSL/TLS handshake failure: Error: 远程主机强迫关闭了一个现有的连接。 (2746), cause: read ECONNRESET'
    expect(getUserFriendlyError(new Error(raw))).toBe('<errors.tlsHandshake>')
  })

  it('Download failed 映射到下载失败（放最后，避免抢先命中更具体的词）', () => {
    expect(getUserFriendlyError('Download failed: EACCES')).toBe('<errors.eacces>')
  })

  it('未命中已知模式时返回兜底消息而不是原始错误', () => {
    expect(getUserFriendlyError(new Error('some proprietary detail'))).toBe('<errors.unknown>')
    expect(getUserFriendlyError(new Error('secret'), '请检查网络')).toBe('请检查网络')
  })

  it('非 Error 的输入（字符串/对象）也不抛错', () => {
    expect(getUserFriendlyError('ECONNRESET again')).toBe('<errors.econnreset>')
    expect(getUserFriendlyError({ weird: 'object' })).toBe('<errors.unknown>')
    expect(getUserFriendlyError(undefined)).toBe('<errors.unknown>')
  })
})
