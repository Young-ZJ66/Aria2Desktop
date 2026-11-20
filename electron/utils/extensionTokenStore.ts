import * as fs from 'fs'
import type { ExtensionTokenRecord } from './extensionApiCore'

/** 配对签发的 token 落盘文件名（放在 userData 下，与 settings.json 分开：它是凭据不是配置） */
export const TOKEN_FILE_NAME = 'extension-tokens.json'
/** 最多保留的 token 条数：防止反复配对把文件撑大（超出时淘汰最久未使用的） */
export const MAX_TOKEN_RECORDS = 20

/** 只保留形态合法的记录：token 是字符串且 scopes 是数组，其余一律丢弃 */
function isValidRecord(row: unknown): row is ExtensionTokenRecord {
  const record = row as ExtensionTokenRecord
  return typeof record?.token === 'string' && Array.isArray(record?.scopes)
}

/**
 * 扩展 token 存储（D-06）。
 *
 * 为什么单独落一个 JSON 文件、而不是塞进 settings：
 * - token 是**凭据**，不该出现在设置页的明文展示面里，也不该跟着设置导入导出走；
 * - 撤销只需要删掉一条记录，与引擎 RPC 密钥解耦（改密钥不再让所有扩展掉线，反之亦然）。
 *
 * 写入走"临时文件 + rename"：断电/崩溃时不会留下半截 JSON 把扩展永久挡在门外。
 * 读取失败（文件损坏/权限不足）一律按"没有已配对扩展"处理并记日志——
 * 宁可让用户重新配对，也不要因为读盘异常让服务起不来。
 */
export class ExtensionTokenStore {
  private records: ExtensionTokenRecord[] | null = null
  /** 上次读到/写入时的文件指纹（mtime+size），用于发现"被外部改写"的配对记录 */
  private stamp: string | null = null

  constructor(
    private readonly filePath: string,
    private readonly logger: { warn: (message: string, error?: unknown) => void }
  ) {}

  /**
   * 读文件指纹。缓存不能只靠"读过一次"就永久有效：
   * 端到端验证脚本、设置导入、用户手动修复都会直接改写这个文件，
   * 只认内存缓存会让这些场景必须重启应用才生效。
   */
  private fileStamp(): string | null {
    try {
      const stat = fs.statSync(this.filePath)
      return `${stat.mtimeMs}:${stat.size}`
    } catch {
      return null
    }
  }

  list(): ExtensionTokenRecord[] {
    const stamp = this.fileStamp()
    if (this.records && stamp === this.stamp) return this.records
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const rows = Array.isArray(parsed) ? parsed : []
      this.records = rows.filter(isValidRecord)
      this.stamp = stamp
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') this.logger.warn('读取扩展配对记录失败，按未配对处理:', error)
      this.records = []
      this.stamp = null
    }
    return this.records
  }

  /** 新增一条记录并落盘；同一扩展重复配对时替换旧记录（旧 token 立即失效） */
  add(record: ExtensionTokenRecord): void {
    const rows = this.list().filter((row) => row.extensionId !== record.extensionId)
    rows.unshift(record)
    this.records = rows.slice(0, MAX_TOKEN_RECORDS)
    this.flush()
  }

  /** 撤销一枚 token（按值删除），返回是否真的删掉了 */
  revoke(token: string): boolean {
    const rows = this.list()
    const next = rows.filter((row) => row.token !== token)
    if (next.length === rows.length) return false
    this.records = next
    this.flush()
    return true
  }

  /** 撤销某个扩展的全部 token（设置页"撤销"按扩展维度操作） */
  revokeExtension(extensionId: string): number {
    const rows = this.list()
    const next = rows.filter((row) => row.extensionId !== extensionId)
    const removed = rows.length - next.length
    if (removed > 0) {
      this.records = next
      this.flush()
    }
    return removed
  }

  /** 刷新 lastSeenAt（只在跨过一分钟时才落盘，避免每次调用都写文件） */
  touch(token: string): void {
    const record = this.list().find((row) => row.token === token)
    if (!record) return
    const now = Date.now()
    if (record.lastSeenAt && now - record.lastSeenAt < 60_000) return
    record.lastSeenAt = now
    this.flush()
  }

  private flush(): void {
    const rows = this.records ?? []
    try {
      const tmp = `${this.filePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 0o600 })
      fs.renameSync(tmp, this.filePath)
      // 自己写完就更新指纹，否则下次 list() 会以为"文件被外部改了"而白读一遍
      this.stamp = this.fileStamp()
    } catch (error) {
      this.logger.warn('写入扩展配对记录失败:', error)
    }
  }
}
