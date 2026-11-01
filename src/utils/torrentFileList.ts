/**
 * 从 .torrent 字节解析文件列表（下载前勾选文件用）。
 *
 * 只实现 torrent 元数据需要的 bencode 子集（int / bytes / list / dict），
 * 不引入第三方解析库；索引从 1 开始，与 aria2 的 `select-file` 选项一致。
 */

type BValue = number | Uint8Array | BValue[] | BDict

interface BDict {
  [key: string]: BValue
}

export interface TorrentFileEntry {
  /** 1 起的文件序号，直接用于 aria2 select-file */
  index: number
  /** 相对路径（多文件种子用 / 连接） */
  path: string
  length: number
}

export interface TorrentFileList {
  name: string
  files: TorrentFileEntry[]
}

function isDict(value: BValue | undefined): value is BDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

function decodeAt(bytes: Uint8Array, start: number): { value: BValue; next: number } {
  if (start >= bytes.length) throw new Error('torrent 数据不完整')

  const marker = bytes[start]!
  // string: <长度>:<内容>
  if (marker >= 0x30 && marker <= 0x39) {
    const colon = bytes.indexOf(0x3a, start)
    if (colon === -1) throw new Error('torrent 字符串缺少分隔符')
    const lengthText = new TextDecoder().decode(bytes.subarray(start, colon))
    const length = Number(lengthText)
    if (!Number.isInteger(length) || length < 0) throw new Error('torrent 字符串长度非法')
    const end = colon + 1 + length
    if (end > bytes.length) throw new Error('torrent 字符串越界')
    return { value: bytes.subarray(colon + 1, end), next: end }
  }

  // int: i<数字>e
  if (marker === 0x69) {
    const end = bytes.indexOf(0x65, start + 1)
    if (end === -1) throw new Error('torrent 整数缺少结束符')
    const value = Number(new TextDecoder().decode(bytes.subarray(start + 1, end)))
    if (!Number.isFinite(value)) throw new Error('torrent 整数非法')
    return { value, next: end + 1 }
  }

  // list: l<值...>e
  if (marker === 0x6c) {
    const list: BValue[] = []
    let pos = start + 1
    while (pos < bytes.length && bytes[pos] !== 0x65) {
      const item = decodeAt(bytes, pos)
      list.push(item.value)
      pos = item.next
    }
    if (pos >= bytes.length) throw new Error('torrent 列表未结束')
    return { value: list, next: pos + 1 }
  }

  // dict: d<key><value>...e
  if (marker === 0x64) {
    const dict: BDict = {}
    let pos = start + 1
    while (pos < bytes.length && bytes[pos] !== 0x65) {
      const key = decodeAt(bytes, pos)
      if (!(key.value instanceof Uint8Array)) throw new Error('torrent 字典键必须是字符串')
      const value = decodeAt(bytes, key.next)
      dict[new TextDecoder().decode(key.value)] = value.value
      pos = value.next
    }
    if (pos >= bytes.length) throw new Error('torrent 字典未结束')
    return { value: dict, next: pos + 1 }
  }

  throw new Error('torrent 数据格式不受支持')
}

function decodeText(value: BValue | undefined): string {
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : ''
}

function decodePath(value: BValue | undefined): string {
  if (!Array.isArray(value)) return ''
  return value.map(part => decodeText(part)).filter(Boolean).join('/')
}

/**
 * 解析 torrent 文件列表。
 *
 * 单文件种子（info.length）与多文件种子（info.files）都支持；
 * 中文路径优先取 `path.utf-8`，与主流客户端一致。
 */
export function parseTorrentFiles(data: Uint8Array): TorrentFileList {
  const root = decodeAt(data, 0).value
  if (!isDict(root)) throw new Error('torrent 根结构非法')
  const info = root.info
  if (!isDict(info)) throw new Error('torrent 缺少 info')

  const name = decodeText(info['name.utf-8']) || decodeText(info.name) || 'torrent'

  const rawFiles = info.files
  if (Array.isArray(rawFiles)) {
    const files: TorrentFileEntry[] = []
    rawFiles.forEach((raw, i) => {
      if (!isDict(raw)) return
      const path = decodePath(raw['path.utf-8']) || decodePath(raw.path)
      const length = typeof raw.length === 'number' ? raw.length : 0
      files.push({ index: i + 1, path: path || `${name}/${i + 1}`, length })
    })
    if (files.length === 0) throw new Error('torrent 不含文件')
    return { name, files }
  }

  const length = typeof info.length === 'number' ? info.length : 0
  return { name, files: [{ index: 1, path: name, length }] }
}
