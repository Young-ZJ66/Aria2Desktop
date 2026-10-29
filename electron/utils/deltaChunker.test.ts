import { describe, expect, it } from 'vitest'
import * as crypto from 'node:crypto'
import { CDC_AVG_SIZE, CDC_MAX_SIZE, CDC_MIN_SIZE, computeChunkSpans } from './deltaChunker'

/** 确定性伪随机填充（避免 Buffer.fill 同字节导致切点分布失真） */
function fill(length: number, seed: number): Buffer {
  const buffer = Buffer.alloc(length)
  let state = seed >>> 0
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    buffer[i] = state >>> 24
  }
  return buffer
}

function hashSpans(buffer: Buffer, spans: { offset: number; size: number }[]): Set<string> {
  return new Set(
    spans.map((span) =>
      crypto.createHash('sha256').update(buffer.subarray(span.offset, span.offset + span.size)).digest('hex')
    )
  )
}

describe('computeChunkSpans（内容定义分块）', () => {
  it('空输入返回空数组', () => {
    expect(computeChunkSpans(Buffer.alloc(0))).toEqual([])
  })

  it('切点连续无缝覆盖整个文件，且块长在 [min,max] 内（末块除外）', () => {
    const buffer = fill(10 * 1024 * 1024 + 12345, 7)
    const spans = computeChunkSpans(buffer)
    expect(spans.length).toBeGreaterThan(1)
    let expectedOffset = 0
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!
      expect(span.offset).toBe(expectedOffset)
      expect(span.size).toBeGreaterThan(0)
      expect(span.size).toBeLessThanOrEqual(CDC_MAX_SIZE)
      if (i < spans.length - 1) expect(span.size).toBeGreaterThanOrEqual(CDC_MIN_SIZE)
      expectedOffset += span.size
    }
    expect(expectedOffset).toBe(buffer.length)
  })

  it('同一字节序列的分块结果确定不变（生成端可复现）', () => {
    const buffer = fill(6 * 1024 * 1024, 11)
    expect(computeChunkSpans(buffer)).toEqual(computeChunkSpans(buffer))
  })

  it('中部插入数据后，后续大部分块仍能命中（固定分块做不到）', () => {
    const original = fill(12 * 1024 * 1024, 13)
    const inserted = fill(200 * 1024, 17)
    const modified = Buffer.concat([
      original.subarray(0, 5 * 1024 * 1024),
      inserted,
      original.subarray(5 * 1024 * 1024)
    ])

    const originalHashes = hashSpans(original, computeChunkSpans(original))
    const modifiedHashes = hashSpans(modified, computeChunkSpans(modified))

    let matched = 0
    for (const hash of modifiedHashes) {
      if (originalHashes.has(hash)) matched++
    }
    // 命中率按"块数"近似：插入 200KB 只应影响插入点附近 1-2 块
    expect(matched / modifiedHashes.size).toBeGreaterThan(0.8)
    expect(CDC_AVG_SIZE).toBe(1024 * 1024)
  })
})
