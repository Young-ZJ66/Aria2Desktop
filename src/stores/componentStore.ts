/**
 * 外部下载组件（yt-dlp / ffmpeg）的运行状态。
 *
 * 安装入口在「设置 → 工具与扩展」，使用入口在新建下载的流媒体页，
 * 两边必须共享同一份"是否可用 / 是否正在安装"状态：
 * 否则在设置里装完再回到流媒体页，仍会显示未安装。
 */

import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { withMinimumDuration } from '@/composables/useMinimumLoading'

export interface ComponentStatus {
  /** 是否已检测过：false 时界面显示"检测中"而不是"未安装" */
  checked: boolean
  checking: boolean
  available: boolean
  version: string
  installable: boolean
  approxSizeMB: number | null
  installing: boolean
  installPercent: number
}

export interface ComponentInstallResult {
  success: boolean
  version?: string
  error?: string
}

function initialStatus(): ComponentStatus {
  return {
    checked: false,
    checking: false,
    available: false,
    version: '',
    installable: false,
    approxSizeMB: null,
    installing: false,
    installPercent: 0
  }
}

export const useComponentStore = defineStore('components', () => {
  const ytdlp = reactive<ComponentStatus>(initialStatus())
  const ffmpeg = reactive<ComponentStatus>(initialStatus())

  /** 安装进度是独立事件通道（invoke 只返回最终结果），只需订阅一次 */
  let progressHooked = false
  function hookProgress(): void {
    if (progressHooked) return
    progressHooked = true
    window.electronAPI?.onYtdlpInstallProgress?.((progress) => {
      ytdlp.installPercent = progress.percent ?? 0
    })
    window.electronAPI?.onFfmpegInstallProgress?.((progress) => {
      ffmpeg.installPercent = progress.percent ?? 0
    })
  }

  async function checkYtdlp(force = false): Promise<void> {
    if (ytdlp.checking || (ytdlp.checked && !force)) return
    if (!window.electronAPI?.ytdlpCheck) {
      ytdlp.checked = true
      return
    }
    ytdlp.checking = true
    try {
      const check = window.electronAPI.ytdlpCheck
      const result = await withMinimumDuration(() => check())
      ytdlp.available = result.available
      ytdlp.version = result.version ?? ''
      ytdlp.installable = result.installable === true
      ytdlp.approxSizeMB = result.approxSizeMB ?? null
    } catch {
      // 检测失败按未安装处理（与旧行为一致）
    } finally {
      ytdlp.checking = false
      ytdlp.checked = true
    }
  }

  async function checkFfmpeg(force = false): Promise<void> {
    if (ffmpeg.checking || (ffmpeg.checked && !force)) return
    if (!window.electronAPI?.ffmpegCheck) {
      ffmpeg.checked = true
      return
    }
    ffmpeg.checking = true
    try {
      const check = window.electronAPI.ffmpegCheck
      const result = await withMinimumDuration(() => check())
      ffmpeg.available = result.available
      ffmpeg.version = result.version ?? ''
      ffmpeg.installable = result.installable === true
      ffmpeg.approxSizeMB = result.approxSizeMB ?? null
    } catch {
      // 忽略
    } finally {
      ffmpeg.checking = false
      ffmpeg.checked = true
    }
  }

  async function installYtdlp(): Promise<ComponentInstallResult> {
    hookProgress()
    if (!window.electronAPI?.ytdlpInstall || ytdlp.installing) {
      return { success: false, error: 'Not available' }
    }
    ytdlp.installing = true
    ytdlp.installPercent = 0
    try {
      const result = await window.electronAPI.ytdlpInstall()
      if (result.success) await checkYtdlp(true)
      return result
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      ytdlp.installing = false
      ytdlp.installPercent = 0
    }
  }

  async function installFfmpeg(): Promise<ComponentInstallResult> {
    hookProgress()
    if (!window.electronAPI?.ffmpegInstall || ffmpeg.installing) {
      return { success: false, error: 'Not available' }
    }
    ffmpeg.installing = true
    ffmpeg.installPercent = 0
    try {
      const result = await window.electronAPI.ffmpegInstall()
      if (result.success) await checkFfmpeg(true)
      return result
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      ffmpeg.installing = false
      ffmpeg.installPercent = 0
    }
  }

  return {
    ytdlp,
    ffmpeg,
    checkYtdlp,
    checkFfmpeg,
    installYtdlp,
    installFfmpeg
  }
})
