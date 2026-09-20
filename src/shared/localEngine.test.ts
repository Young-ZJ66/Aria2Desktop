import { describe, expect, it } from 'vitest'
import { DEFAULT_RPC_PORT, LOCAL_ENGINE_HOSTS, isLocalEngineAddress } from './localEngine'

/**
 * 本机引擎地址判定是主进程（同步连接预设密钥）与渲染层（补齐预设密钥）共用的口径，
 * 口径不一致会导致"引擎要 token、前端不发 token"的连接失败，因此这里把边界锁死。
 */
describe('isLocalEngineAddress', () => {
  it('识别常见本机主机名', () => {
    expect(isLocalEngineAddress('localhost', 6800, 6800)).toBe(true)
    expect(isLocalEngineAddress('127.0.0.1', 6800, 6800)).toBe(true)
    expect(isLocalEngineAddress('::1', 6800, 6800)).toBe(true)
  })

  it('主机名大小写不敏感', () => {
    expect(isLocalEngineAddress('LOCALHOST', 6800, 6800)).toBe(true)
    expect(isLocalEngineAddress('LocalHost', 6800, 6800)).toBe(true)
  })

  it('端口不一致时不算本机引擎', () => {
    expect(isLocalEngineAddress('localhost', 6801, 6800)).toBe(false)
    // 字符串端口也要能正确比较（连接预设来自持久化 JSON，可能是字符串）
    expect(isLocalEngineAddress('localhost', '6800', 6800)).toBe(true)
  })

  it('引擎端口缺省时按默认端口比较', () => {
    expect(isLocalEngineAddress('localhost', 6800, undefined)).toBe(true)
    expect(isLocalEngineAddress('localhost', 6801, undefined)).toBe(false)
  })

  it('远程主机一律不算本机引擎', () => {
    expect(isLocalEngineAddress('192.168.1.10', 6800, 6800)).toBe(false)
    expect(isLocalEngineAddress('nas.local', 6800, 6800)).toBe(false)
    // 前缀相似但并非本机
    expect(isLocalEngineAddress('localhost.evil.com', 6800, 6800)).toBe(false)
  })

  it('主机名缺失或为空时不算本机引擎', () => {
    expect(isLocalEngineAddress(undefined, 6800, 6800)).toBe(false)
    expect(isLocalEngineAddress('', 6800, 6800)).toBe(false)
  })

  it('常量与实际使用保持一致', () => {
    expect(LOCAL_ENGINE_HOSTS.has('localhost')).toBe(true)
    expect(DEFAULT_RPC_PORT).toBe(6800)
  })
})
