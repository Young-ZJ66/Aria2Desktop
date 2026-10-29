/**
 * 内容定义分块（CDC）——生成差量块表时使用（纯函数，禁止 import electron）。
 *
 * 为什么不用固定 4MB 分块：实测相邻两个 NSIS 安装包（1.0.8→1.0.9、1.0.9→1.1.0）
 * 在固定偏移下**没有任何一块命中**（收益 0）——安装包内部是压缩数据，任何改动都会
 * 让后续所有块的偏移内容整体错位。改用内容定义切点后，切点只由局部字节决定，
 * 插入/删除不会影响后续块，实测同两对安装包可复用 93.7%~94.2% 的字节。
 *
 * 算法（Gear hash）：逐字节 hash = (hash << 1) + GEAR[byte]，取低 20 位为 0 作为切点
 * （平均约 1MB 一块），并设最小 256KB / 最大 4MB，避免超小块与超大块。
 * 生成端与校验端的唯一约定是**块表里的 offset/size**，应用端不参与分块，
 * 因此算法变更只需与块表一起发布，老客户端读到新表也会因格式校验失败而安全回落全量。
 */

/** 最小块：过小的块会让块表条目过多、HTTP Range 请求过碎 */
export const CDC_MIN_SIZE = 256 * 1024
/** 平均块大小（切点概率 1/2^20） */
export const CDC_AVG_SIZE = 1024 * 1024
/** 最大块：避免压缩率高/低熵区域长期不出现切点 */
export const CDC_MAX_SIZE = 4 * 1024 * 1024

/** 由固定种子生成的 Gear 表（必须与历史块表保持一致，否则同一文件会切出不同块） */
const GEAR_TABLE = (() => {
  const table = new Uint32Array(256)
  let seed = 0x9e3779b9
  for (let i = 0; i < 256; i++) {
    seed = Math.imul(seed ^ (seed >>> 15), 0x85ebca6b) >>> 0
    table[i] = seed
  }
  return table
})()

const CUT_MASK = (1 << Math.round(Math.log2(CDC_AVG_SIZE))) - 1

/** 一个分块在文件中的位置（不含 hash；hash 由生成端计算） */
export interface ChunkSpan {
  offset: number
  size: number
}

/**
 * 计算内容定义分块的边界。
 *
 * 确定性：同一字节序列永远得到同一组切点；空输入返回空数组。
 * 最后一块可能小于 CDC_MIN_SIZE（文件尾），这是正常的。
 */
export function computeChunkSpans(buffer: Buffer): ChunkSpan[] {
  if (buffer.length === 0) return []
  const spans: ChunkSpan[] = []
  let start = 0
  let hash = 0
  for (let i = 0; i < buffer.length; i++) {
    hash = ((hash << 1) + GEAR_TABLE[buffer[i]]) >>> 0
    const size = i - start + 1
    if (size < CDC_MIN_SIZE) continue
    if ((hash & CUT_MASK) === 0 || size >= CDC_MAX_SIZE) {
      spans.push({ offset: start, size })
      start = i + 1
      hash = 0
    }
  }
  if (start < buffer.length) {
    spans.push({ offset: start, size: buffer.length - start })
  }
  return spans
}
