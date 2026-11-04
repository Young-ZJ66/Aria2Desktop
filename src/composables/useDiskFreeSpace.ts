import { ref, watch, type Ref, type WatchSource } from 'vue'
import { DISK_SPACE_UNKNOWN } from '@/utils/diskSpace'

/**
 * 目标磁盘剩余空间的防抖查询（新建任务各页共用）。
 *
 * 目录每敲一个字符都会变化，逐键 statfs 没有意义——500ms 防抖后只查最终目录；
 * 空目录（跟随基础目录设置）同样查询，让用户随时看到默认盘的余量。
 * 查询失败（目录不存在等）保持 unknown 哨兵，UI 不显示，绝不阻塞表单。
 *
 * @param dirSource 目录的可响应源（computed/ref/ getter 均可）
 */
export function useDiskFreeSpace(dirSource: WatchSource<string>): Ref<number> {
  const freeBytes = ref(DISK_SPACE_UNKNOWN)
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(dirSource, (dir) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      const api = window.electronAPI?.getDiskFreeSpace
      if (!api || !dir) {
        freeBytes.value = DISK_SPACE_UNKNOWN
        return
      }
      try {
        const space = await api(dir)
        freeBytes.value = space.free
      } catch {
        freeBytes.value = DISK_SPACE_UNKNOWN
      }
    }, 500)
  }, { immediate: true })

  return freeBytes
}
