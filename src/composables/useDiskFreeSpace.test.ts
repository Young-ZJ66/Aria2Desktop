import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * 新建任务页的磁盘余量查询。
 *
 * 要点：目录每敲一个字符都变，必须防抖成只查最后一次；查询失败要静默退回
 * 「未知」哨兵，绝不能把异常抛进表单或显示 -1 给用户看。
 */
import { useDiskFreeSpace } from './useDiskFreeSpace'
import { DISK_SPACE_UNKNOWN } from '@/utils/diskSpace'

const getDiskFreeSpace = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  getDiskFreeSpace.mockReset()
  ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { getDiskFreeSpace } }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('useDiskFreeSpace', () => {
  it('500ms 防抖后才查询，并写回剩余空间', async () => {
    getDiskFreeSpace.mockResolvedValue({ free: 1024, total: 4096 })
    const dir = ref('/downloads')
    const free = useDiskFreeSpace(dir)
    expect(free.value).toBe(DISK_SPACE_UNKNOWN)
    await vi.advanceTimersByTimeAsync(499)
    expect(getDiskFreeSpace).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(getDiskFreeSpace).toHaveBeenCalledWith('/downloads')
    expect(free.value).toBe(1024)
  })

  it('连续改目录只查最后一次（逐键 statfs 没有意义）', async () => {
    getDiskFreeSpace.mockResolvedValue({ free: 2048, total: 4096 })
    const dir = ref('/d')
    const free = useDiskFreeSpace(dir)
    dir.value = '/do'
    await vi.advanceTimersByTimeAsync(100)
    dir.value = '/downloads'
    await vi.advanceTimersByTimeAsync(500)
    expect(getDiskFreeSpace).toHaveBeenCalledTimes(1)
    expect(getDiskFreeSpace).toHaveBeenCalledWith('/downloads')
    expect(free.value).toBe(2048)
  })

  it('空目录（跟随基础目录设置）不查询，保持未知哨兵', async () => {
    const dir = ref('')
    const free = useDiskFreeSpace(dir)
    await vi.advanceTimersByTimeAsync(600)
    expect(getDiskFreeSpace).not.toHaveBeenCalled()
    expect(free.value).toBe(DISK_SPACE_UNKNOWN)
  })

  it('主进程接口缺失时不报错，保持未知', async () => {
    ;(globalThis as unknown as { window: unknown }).window = {}
    const dir = ref('/downloads')
    const free = useDiskFreeSpace(dir)
    await vi.advanceTimersByTimeAsync(600)
    expect(free.value).toBe(DISK_SPACE_UNKNOWN)
  })

  it('查询抛错时吞掉异常并回到未知（不能阻塞表单）', async () => {
    getDiskFreeSpace.mockRejectedValue(new Error('statfs failed'))
    const dir = ref('/downloads')
    const free = useDiskFreeSpace(dir)
    await vi.advanceTimersByTimeAsync(600)
    expect(free.value).toBe(DISK_SPACE_UNKNOWN)
  })

  it('目录切回空串时把上一次结果复位为未知', async () => {
    getDiskFreeSpace.mockResolvedValue({ free: 1024, total: 4096 })
    const dir = ref('/downloads')
    const free = useDiskFreeSpace(dir)
    await vi.advanceTimersByTimeAsync(600)
    expect(free.value).toBe(1024)
    dir.value = ''
    await vi.advanceTimersByTimeAsync(600)
    expect(free.value).toBe(DISK_SPACE_UNKNOWN)
  })
})
