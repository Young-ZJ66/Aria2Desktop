import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { isInsideDownloadRoot } from './downloadPathPolicy'

describe('isInsideDownloadRoot：下载目录边界', () => {
  it('允许根目录本身与子目录', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-root-'))
    const child = path.join(root, 'movies')
    fs.mkdirSync(child)
    try {
      expect(await isInsideDownloadRoot(root, root)).toBe(true)
      expect(await isInsideDownloadRoot(child, root)).toBe(true)
      expect(await isInsideDownloadRoot(path.join(root, 'not-created-yet', 'a.bin'), root)).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('拒绝父目录、相邻同名前缀目录与相对路径', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-root-'))
    const sibling = root + '-evil'
    fs.mkdirSync(sibling)
    try {
      expect(await isInsideDownloadRoot(path.dirname(root), root)).toBe(false)
      expect(await isInsideDownloadRoot(sibling, root)).toBe(false)
      expect(await isInsideDownloadRoot(path.join(root, '..', 'escape.bin'), root)).toBe(false)
      expect(await isInsideDownloadRoot('relative/file.bin', root)).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(sibling, { recursive: true, force: true })
    }
  })

  it('通过符号链接逃逸时按真实路径拒绝', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-root-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-outside-'))
    const link = path.join(root, 'link')
    try {
      fs.symlinkSync(outside, link, 'junction')
      // 目标与中间目录都不存在时也要按最近存在祖先解析，不能按字面路径误判为在 root 内
      expect(await isInsideDownloadRoot(path.join(link, 'a.bin'), root)).toBe(false)
      expect(await isInsideDownloadRoot(path.join(link, 'sub', 'a.bin'), root)).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
})
