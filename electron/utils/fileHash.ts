/**
 * 文件 SHA-256（流式）。
 *
 * 下载的二进制几十 MB，readFileSync 整包读入会阻塞主进程事件循环
 * （校验期间 UI 冻结、IPC 无响应），因此统一用流式分块。
 */

import * as crypto from 'crypto'
import * as fs from 'fs'

export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
