/**
 * 差量更新的块表（delta blocks）纯逻辑。
 *
 * 什么是块表：把安装包按固定块大小（4MB）切分，记录每块的 offset/size/sha256。
 * CI 端在发布时生成并上传（`<安装包>.blocks.json`），应用端更新时下载新版块表，
 * 与本地缓存的上版块表对比——hash 相同的块直接从旧文件复制，只下载变化的部分。
 *
 * 为什么自己定义格式而不是用 electron-builder 的 .blockmap：blockmap 是 zstd 压缩的，
 * 解压依赖较新的 Node 内建（node:zlib 的 zstd 支持），而本格式是纯 JSON——
 * 零依赖、可读、可在 CI 里用十几行脚本生成，块级校验字段与最终的全量 SHA-256 校验互不冲突。
 *
 * 安全边界：块表**不是**信任边界——差量组装完成后仍要走 UpdateController 的全量
 * SHA-256 强制校验（安全红线，见 verifyChecksum）。被篡改的块表只会导致组装失败、
 * 校验不通过、回落全量，不会让坏包落地。
 */

/** 单个分块在安装包中的位置与指纹 */
export interface DeltaBlockEntry {
  /** 块起始偏移（字节） */
  offset: number
  /** 块长度（最后一块可能不足 blockSize） */
  size: number
  /** 块内容的 SHA-256（hex） */
  sha256: string
}

/** 安装包的完整块表（`<安装包>.blocks.json` 的 JSON 结构） */
export interface DeltaBlockTable {
  /** 生成该表的版本号（从安装包文件名解析，下载端用于防错位） */
  version: string
  /** 安装包总字节数 */
  size: number
  /** 分块大小（字节，当前为 4MB） */
  blockSize: number
  blocks: DeltaBlockEntry[]
}

/** 差量计划中的一条指令：把某段字节写到目标文件的指定位置 */
export interface DeltaOp {
  /** 写入目标（新版安装包）的起始偏移 */
  targetOffset: number
  /** 段长度（相邻同源块合并后可达数十 MB） */
  size: number
  /** 数据来源：本地旧包的某个偏移，或远端新包的某个偏移 */
  source: { type: 'local'; offset: number } | { type: 'remote'; offset: number }
}

/** planDelta 的产出：指令序列 + 需要从网络下载的总字节数 */
export interface DeltaPlan {
  ops: DeltaOp[]
  /** remote 段合计字节数（差量收益的直接度量） */
  remoteBytes: number
}

/** 块表 JSON 的结构校验（接口边界不信任网络/磁盘内容，字段逐项验证） */
export function isDeltaBlockTable(value: unknown): value is DeltaBlockTable {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.version !== 'string' || !v.version) return false
  if (!Number.isSafeInteger(v.size) || (v.size as number) <= 0) return false
  if (!Number.isSafeInteger(v.blockSize) || (v.blockSize as number) <= 0) return false
  if (!Array.isArray(v.blocks) || v.blocks.length === 0) return false
  let covered = 0
  for (const block of v.blocks) {
    const b = block as Record<string, unknown>
    if (!Number.isSafeInteger(b.offset) || !Number.isSafeInteger(b.size)) return false
    if (typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.sha256)) return false
    // 偏移必须连续无缝、无重叠，且不越界——错位块表会组装出损坏的安装包
    if ((b.offset as number) !== covered) return false
    if ((b.size as number) <= 0 || covered + (b.size as number) > (v.size as number)) return false
    covered += b.size as number
  }
  // 分块必须恰好覆盖整个文件
  return covered === v.size
}

/**
 * 生成差量计划：按新版块表逐块查旧版块表，hash 命中 → 本地复制；未命中 → 远端下载。
 *
 * 相邻同源块合并成一条指令（local-local、remote-remote 且偏移连续时拼接）：
 * local 段越大，磁盘复制越是顺序 IO；remote 段越大，HTTP 请求数越少。
 * 两张表里"源偏移连续"的判定只对同 type 成立——local 与 remote 交替时不能跨类型拼。
 */
export function planDelta(oldTable: DeltaBlockTable, newTable: DeltaBlockTable): DeltaPlan {
  // 旧表 hash → 首个偏移。同一 hash 多次出现时取第一处即可（内容相同，复制哪份都一样）
  const oldByHash = new Map<string, number>()
  for (const block of oldTable.blocks) {
    if (!oldByHash.has(block.sha256)) oldByHash.set(block.sha256, block.offset)
  }

  const ops: DeltaOp[] = []
  let remoteBytes = 0

  const pushOrMerge = (op: DeltaOp): void => {
    const last = ops[ops.length - 1]
    if (last && last.source.type === op.source.type && last.targetOffset + last.size === op.targetOffset) {
      // 源偏移也必须连续：同类型（local/local 或 remote/remote）且源文件里也相邻才能拼成一条，
      // 否则一条指令就得表达"两段来源"，复制/下载都无从执行
      if (last.source.offset + last.size === op.source.offset) {
        last.size += op.size
        return
      }
    }
    ops.push(op)
  }

  for (const block of newTable.blocks) {
    const localOffset = oldByHash.get(block.sha256)
    if (localOffset !== undefined) {
      pushOrMerge({ targetOffset: block.offset, size: block.size, source: { type: 'local', offset: localOffset } })
    } else {
      pushOrMerge({ targetOffset: block.offset, size: block.size, source: { type: 'remote', offset: block.offset } })
      remoteBytes += block.size
    }
  }

  return { ops, remoteBytes }
}
