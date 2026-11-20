import { describe, expect, it } from 'vitest'
import { isReservedSecretPrefix, SECRET_CIPHER_PREFIX } from './secretPrefix'

/**
 * RPC secret 保留前缀的回归测试。
 *
 * 主进程用 `v1:` 区分密文与旧明文，渲染层用它做输入校验。两边共用同一份常量：
 * 前缀一变而校验没跟着变，用户设的密钥会被当密文存下、解密失败后被清空，
 * 表现为「设置保存成功但连接一直 401」。
 */
describe('SECRET_CIPHER_PREFIX', () => {
  it('固定为 v1:（改动前必须同步主进程解密逻辑）', () => {
    expect(SECRET_CIPHER_PREFIX).toBe('v1:')
  })
})

describe('isReservedSecretPrefix', () => {
  it('以 v1: 开头即视为保留前缀', () => {
    expect(isReservedSecretPrefix('v1:abc')).toBe(true)
    expect(isReservedSecretPrefix('v1:')).toBe(true)
    expect(isReservedSecretPrefix('v1:token:with:colons')).toBe(true)
  })

  it('普通明文密钥不算保留前缀', () => {
    expect(isReservedSecretPrefix('mysecret')).toBe(false)
    expect(isReservedSecretPrefix('V1:abc')).toBe(false)
    expect(isReservedSecretPrefix('xv1:abc')).toBe(false)
    expect(isReservedSecretPrefix('')).toBe(false)
  })
})
