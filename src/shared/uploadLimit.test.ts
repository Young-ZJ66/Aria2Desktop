import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RPC_MAX_REQUEST_BYTES,
  maxUploadFileBytes,
  parseRpcMaxRequestBytes,
  RPC_BODY_OVERHEAD_BYTES
} from './uploadLimit'

describe('parseRpcMaxRequestBytes', () => {
  it('解析纯字节数', () => {
    expect(parseRpcMaxRequestBytes('2097152')).toBe(2 * 1024 * 1024)
  })

  it('解析带单位后缀', () => {
    expect(parseRpcMaxRequestBytes('4M')).toBe(4 * 1024 * 1024)
    expect(parseRpcMaxRequestBytes('512K')).toBe(512 * 1024)
  })

  it('缺失或非法值回退默认 2M', () => {
    expect(parseRpcMaxRequestBytes(undefined)).toBe(DEFAULT_RPC_MAX_REQUEST_BYTES)
    expect(parseRpcMaxRequestBytes('')).toBe(DEFAULT_RPC_MAX_REQUEST_BYTES)
    expect(parseRpcMaxRequestBytes('0')).toBe(DEFAULT_RPC_MAX_REQUEST_BYTES)
    expect(parseRpcMaxRequestBytes('abc')).toBe(DEFAULT_RPC_MAX_REQUEST_BYTES)
  })
})

describe('maxUploadFileBytes', () => {
  it('按 base64 膨胀 4/3 折算并预留请求体开销', () => {
    const limit = 2 * 1024 * 1024
    const allowed = maxUploadFileBytes(limit)
    // 编码后体积必须严格不超过上限
    const encoded = Math.ceil(allowed / 3) * 4
    expect(encoded).toBeLessThanOrEqual(limit)
    // 折算后应接近上限的 3/4（不会因保守过度而腰斩）
    expect(allowed).toBeGreaterThan(Math.floor((limit - RPC_BODY_OVERHEAD_BYTES) * 0.74))
    expect(allowed % 3).toBe(0)
  })

  it('上限太小导致无可用空间时返回 0', () => {
    expect(maxUploadFileBytes(1024)).toBe(0)
    expect(maxUploadFileBytes(0)).toBe(0)
    expect(maxUploadFileBytes(-1)).toBe(0)
  })
})
