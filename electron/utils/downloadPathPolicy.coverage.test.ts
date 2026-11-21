import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { isInsideDownloadRoot } from './downloadPathPolicy'

/**
 * 下载目录边界判定的兜底路径。
 *
 * 正常路径已有真实文件系统用例覆盖，这里补两个「拿不到真实路径」的分支：
 * 空参数必须立刻拒绝（不能去碰文件系统），以及 realpath 一路失败时退回字面绝对路径。
 */

const realpathSpy = vi.spyOn(fs.promises, 'realpath')

afterEach(() => {
  realpathSpy.mockReset()
})

describe('isInsideDownloadRoot 的兜底路径', () => {
  it('空目标或空根目录直接拒绝，且不触碰文件系统', async () => {
    expect(await isInsideDownloadRoot('', '/srv/downloads')).toBe(false)
    expect(await isInsideDownloadRoot('/srv/downloads/a.bin', '')).toBe(false)
    expect(realpathSpy).not.toHaveBeenCalled()
  })

  it('realpath 全部失败时退回字面绝对路径判定', async () => {
    realpathSpy.mockRejectedValue(new Error('ENOENT'))
    const root = path.join(path.sep, 'srv', 'downloads')
    const inside = path.join(root, 'movies', 'a.bin')
    const outside = path.join(path.sep, 'srv', 'other', 'a.bin')

    expect(await isInsideDownloadRoot(inside, root)).toBe(true)
    expect(await isInsideDownloadRoot(outside, root)).toBe(false)
    expect(realpathSpy).toHaveBeenCalled()
  })

  it('大小写不敏感开关对同一组路径给出相反结论', async () => {
    // realpath 原样返回，避免宿主机大小写敏感性干扰判定
    realpathSpy.mockImplementation(async (target: fs.PathLike) => String(target))
    const root = '/data/dl'
    const upper = '/DATA/DL/a.bin'

    expect(await isInsideDownloadRoot(upper, root, true)).toBe(true)
    expect(await isInsideDownloadRoot(upper, root, false)).toBe(false)
  })
})
