import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { computeFileSha256 } from './fileHash'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-filehash-'))
afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

function writeTemp(name: string, content: Buffer | string): string {
  const file = path.join(tmpDir, name)
  fs.writeFileSync(file, content)
  return file
}

function expected(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

describe('computeFileSha256 流式计算文件摘要', () => {
  it('空文件得到空串的 SHA-256', async () => {
    const file = writeTemp('empty.bin', Buffer.alloc(0))
    await expect(computeFileSha256(file)).resolves.toBe(expected(Buffer.alloc(0)))
  })

  it('文本内容与 crypto 一次性计算一致', async () => {
    const content = 'hello aria2 desktop'
    const file = writeTemp('text.txt', content)
    await expect(computeFileSha256(file)).resolves.toBe(expected(content))
  })

  it('跨多个数据块的大文件仍得到正确摘要（流式，不整包读入）', async () => {
    const content = crypto.randomBytes(3 * 1024 * 1024 + 17)
    const file = writeTemp('big.bin', content)
    await expect(computeFileSha256(file)).resolves.toBe(expected(content))
  })

  it('文件不存在时 reject（不静默返回空串）', async () => {
    await expect(computeFileSha256(path.join(tmpDir, 'missing.bin'))).rejects.toThrow()
  })
})
