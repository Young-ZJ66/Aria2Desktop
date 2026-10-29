import { describe, expect, it } from 'vitest'
import { isDeltaBlockTable, planDelta, type CdcDeltaBlockTable, type DeltaBlockTable } from './deltaBlocks'

/** 构造一张合法块表：size 按 blocks 自动汇总，保证测试只关心块本身 */
function makeTable(version: string, blockSize: number, hashes: string[]): DeltaBlockTable {
  let offset = 0
  const blocks = hashes.map((sha256, i) => {
    // 最后一块减半，模拟"末块不足 blockSize"的真实形态
    const size = i === hashes.length - 1 ? Math.floor(blockSize / 2) : blockSize
    const entry = { offset, size, sha256 }
    offset += size
    return entry
  })
  return { version, size: offset, blockSize, blocks }
}

const h = (n: number): string => 'a'.repeat(62) + String(n).padStart(2, '0')

/** 构造 CDC（format=2）块表：块长可变 */
function makeCdcTable(version: string, sizes: number[], hashes: string[]): CdcDeltaBlockTable {
  let offset = 0
  const blocks = sizes.map((size, i) => {
    const entry = { offset, size, sha256: hashes[i]! }
    offset += size
    return entry
  })
  return { version, size: offset, format: 2, chunking: 'cdc', avgBlockSize: 1024 * 1024, blocks }
}

describe('isDeltaBlockTable（接口边界：网络/磁盘内容不可信）', () => {
  const valid = makeTable('1.0.10', 4 * 1024 * 1024, [h(1), h(2), h(3)])

  it('合法块表通过', () => {
    expect(isDeltaBlockTable(valid)).toBe(true)
  })

  it('非对象 / 缺字段 / 类型错误一律拒绝', () => {
    for (const bad of [null, undefined, 42, 'x', [], { }, { ...valid, version: '' }]) {
      expect(isDeltaBlockTable(bad)).toBe(false)
    }
    expect(isDeltaBlockTable({ ...valid, size: 0 })).toBe(false)
    expect(isDeltaBlockTable({ ...valid, size: 'x' } as unknown)).toBe(false)
    expect(isDeltaBlockTable({ ...valid, blocks: [] })).toBe(false)
  })

  it('非法 sha256 / 越界 / 块间有缝 / 覆盖不完整一律拒绝', () => {
    // sha256 非 64 位 hex
    expect(isDeltaBlockTable({ ...valid, blocks: [{ ...valid.blocks[0]!, sha256: 'zz' }] })).toBe(false)
    // 块越过文件末尾
    expect(isDeltaBlockTable({ ...valid, blocks: [{ ...valid.blocks[0]!, size: valid.size + 1 }] })).toBe(false)
    // 偏移错位（块表必须从 0 起无缝铺满）
    expect(isDeltaBlockTable({
      ...valid,
      blocks: valid.blocks.map((b, i) => ({ ...b, offset: b.offset + (i === 0 ? 1 : 0) }))
    })).toBe(false)
    // 少一块：总覆盖 < size
    expect(isDeltaBlockTable({ ...valid, blocks: valid.blocks.slice(0, 2) })).toBe(false)
  })

  it('CDC 格式（format=2，块长可变）合法表通过', () => {
    const cdc = makeCdcTable('1.0.11', [1024 * 1024, 3 * 1024 * 1024, 500 * 1024], [h(1), h(2), h(3)])
    expect(isDeltaBlockTable(cdc)).toBe(true)
  })

  it('CDC 格式缺 chunking/avgBlockSize 或未知 format 一律拒绝', () => {
    const cdc = makeCdcTable('1.0.11', [1024 * 1024, 1024 * 1024], [h(1), h(2)])
    expect(isDeltaBlockTable({ ...cdc, chunking: 'fixed' })).toBe(false)
    expect(isDeltaBlockTable({ ...cdc, avgBlockSize: 0 })).toBe(false)
    expect(isDeltaBlockTable({ ...cdc, format: 3 })).toBe(false)
    // 去掉 format 字段则按旧格式要求 blockSize：未提供 → 拒绝
    const rest: Record<string, unknown> = { ...cdc }
    delete rest.format
    delete rest.chunking
    delete rest.avgBlockSize
    expect(isDeltaBlockTable(rest)).toBe(false)
  })
})

describe('planDelta（差量计划的正确性）', () => {
  const BLOCK = 4 * 1024 * 1024

  it('完全相同的两版 → 全部本地复制，零远程字节', () => {
    const t = makeTable('1.0.9', BLOCK, [h(1), h(2), h(3)])
    const plan = planDelta(t, makeTable('1.0.10', BLOCK, [h(1), h(2), h(3)]))
    expect(plan.remoteBytes).toBe(0)
    expect(plan.ops).toHaveLength(1) // 相邻同源合并成一条
    expect(plan.ops[0]?.source.type).toBe('local')
    expect(plan.ops[0]?.size).toBe(t.size)
  })

  it('中间一块变化 → 两段 local 夹一段 remote', () => {
    const oldT = makeTable('1.0.9', BLOCK, [h(1), h(2), h(3), h(4)])
    const newT = makeTable('1.0.10', BLOCK, [h(1), h(9), h(3), h(4)])
    const plan = planDelta(oldT, newT)
    expect(plan.remoteBytes).toBe(BLOCK)
    expect(plan.ops.map(o => o.source.type)).toEqual(['local', 'remote', 'local'])
    // remote 段的源偏移 = 新表中变化块自身的偏移
    expect(plan.ops[1]?.source).toEqual({ type: 'remote', offset: BLOCK })
  })

  it('全新内容 → 全 remote；且 remote 段合并为一条', () => {
    const oldT = makeTable('1.0.9', BLOCK, [h(1), h(2)])
    const newT = makeTable('1.0.10', BLOCK, [h(8), h(9)])
    const plan = planDelta(oldT, newT)
    expect(plan.remoteBytes).toBe(newT.size)
    expect(plan.ops).toHaveLength(1)
    expect(plan.ops[0]?.source.type).toBe('remote')
  })

  it('local 与 remote 交替处不跨类型合并', () => {
    const oldT = makeTable('1.0.9', BLOCK, [h(1), h(2)])
    const newT = makeTable('1.0.10', BLOCK, [h(1), h(9), h(1), h(2)])
    const plan = planDelta(oldT, newT)
    expect(plan.ops.map(o => o.source.type)).toEqual(['local', 'remote', 'local'])
    // 末尾 h(1),h(2) 两块相邻且源连续 → 合并为一条 local
    expect(plan.ops[2]?.size).toBe(BLOCK + BLOCK / 2)
  })

  it('同一 hash 在旧表多次出现时取第一处偏移', () => {
    const oldT = makeTable('1.0.9', BLOCK, [h(1), h(1), h(2)])
    const newT = makeTable('1.0.10', BLOCK, [h(1), h(2)])
    const plan = planDelta(oldT, newT)
    expect(plan.remoteBytes).toBe(0)
    expect(plan.ops[0]?.source).toEqual({ type: 'local', offset: 0 })
  })

  it('写入位置始终跟随新表布局（乱序命中也不串位）', () => {
    const oldT = makeTable('1.0.9', BLOCK, [h(1), h(2), h(3)])
    const newT = makeTable('1.0.10', BLOCK, [h(3), h(9), h(1)])
    const plan = planDelta(oldT, newT)
    const byTarget = [...plan.ops].sort((a, b) => a.targetOffset - b.targetOffset)
    expect(byTarget.map(o => o.targetOffset)).toEqual([0, BLOCK, BLOCK * 2])
    expect(plan.ops.every(o => o.targetOffset + o.size <= newT.size)).toBe(true)
  })

  it('CDC 变长块：按块长复制，远程字节等于实际变化块的字节数', () => {
    const sizes = [1024 * 1024, 3 * 1024 * 1024, 500 * 1024]
    const oldT = makeCdcTable('1.0.10', sizes, [h(1), h(2), h(3)])
    const newT = makeCdcTable('1.0.11', sizes, [h(1), h(9), h(3)])
    const plan = planDelta(oldT, newT)
    expect(plan.remoteBytes).toBe(sizes[1])
    // 第一块与第三块命中旧表对应偏移；中间块整块走远端
    expect(plan.ops[0]?.source).toEqual({ type: 'local', offset: 0 })
    expect(plan.ops[1]?.source).toEqual({ type: 'remote', offset: sizes[0] })
    expect(plan.ops[1]?.size).toBe(sizes[1])
    expect(plan.ops[2]?.source).toEqual({ type: 'local', offset: sizes[0] + sizes[1] })
  })
})
