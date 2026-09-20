import { describe, expect, it } from 'vitest'
import { computeTaskListFingerprint } from './fingerprint'

/**
 * 指纹用于"内容未变化时保留旧数组引用"，避免每秒轮询触发表格无效 diff。
 * 这里锁定：同序列稳定、任一字段变化即变化。
 */
describe('computeTaskListFingerprint', () => {
  it('空列表返回稳定值', () => {
    expect(computeTaskListFingerprint([])).toBe(computeTaskListFingerprint([]))
  })

  it('相同序列结果稳定（顺序敏感）', () => {
    const a = [{ gid: 'a1b2c3d4e5f60001', status: 'active' }]
    const b = [{ gid: 'a1b2c3d4e5f60001', status: 'active' }]
    expect(computeTaskListFingerprint(a)).toBe(computeTaskListFingerprint(b))
  })

  it('gid 或 status 变化都会改变指纹', () => {
    const base = [{ gid: 'a1b2c3d4e5f60001', status: 'active' }]
    const gidChanged = [{ gid: 'a1b2c3d4e5f60002', status: 'active' }]
    const statusChanged = [{ gid: 'a1b2c3d4e5f60001', status: 'paused' }]
    const fp = computeTaskListFingerprint(base)
    expect(computeTaskListFingerprint(gidChanged)).not.toBe(fp)
    expect(computeTaskListFingerprint(statusChanged)).not.toBe(fp)
  })

  it('顺序变化会改变指纹（列表顺序本身参与渲染，不可视为相同）', () => {
    const x = { gid: 'a1b2c3d4e5f60001', status: 'active' }
    const y = { gid: 'a1b2c3d4e5f60002', status: 'active' }
    expect(computeTaskListFingerprint([x, y])).not.toBe(computeTaskListFingerprint([y, x]))
  })

  it('长度变化会改变指纹', () => {
    const one = [{ gid: 'a1b2c3d4e5f60001', status: 'active' }]
    const two = [...one, { gid: 'a1b2c3d4e5f60002', status: 'active' }]
    expect(computeTaskListFingerprint(one)).not.toBe(computeTaskListFingerprint(two))
  })

  it('可处理大列表而不抛错（1000 条）', () => {
    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      gid: `gid${i.toString(16).padStart(13, '0')}`,
      status: 'active'
    }))
    expect(typeof computeTaskListFingerprint(tasks)).toBe('string')
  })
})
