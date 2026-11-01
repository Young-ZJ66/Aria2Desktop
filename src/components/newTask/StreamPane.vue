<template>
  <!-- 组件检测/安装在「设置 → 工具与扩展」；完成检测前只显示检测中，避免闪出未安装 -->
  <div v-if="!componentStore.ytdlp.checked" class="ytdlp-checking">
    <n-spin size="small" />
    <span>{{ t('newTask.streamChecking') }}</span>
  </div>

  <template v-else-if="!componentStore.ytdlp.available">
    <n-alert type="warning" :bordered="false" style="margin-bottom: 12px;">
      {{ t('newTask.streamUrlTip') }}
    </n-alert>
    <n-button type="primary" @click="openComponentSettings">
      {{ t('newTask.openComponentSettings') }}
    </n-button>
  </template>

  <template v-else>
    <n-form>
      <n-form-item :label="t('newTask.urisLabel')" label-placement="top" :show-feedback="false">
        <n-input-group>
          <n-input
            v-model:value="streamUrl"
            :placeholder="t('newTask.streamUrlPlaceholder')"
            :disabled="streamDownloading || streamStarting"
            @keyup.enter="fetchStreamInfo"
          />
          <n-button
            :loading="streamFetching"
            :disabled="!streamUrl.trim() || streamDownloading || streamStarting"
            @click="fetchStreamInfo"
          >
            {{ t('newTask.streamParse') }}
          </n-button>
        </n-input-group>
      </n-form-item>
    </n-form>

    <div v-if="streamFormats.length > 0" style="margin-top: 16px;">
      <n-form-item :label="t('newTask.streamSelectFormat')" label-placement="top">
        <n-select
          v-model:value="selectedFormatId"
          :options="streamFormatOptions"
          :disabled="streamDownloading || streamStarting"
        />
      </n-form-item>

      <!-- 分离的视频流由 App 自动合并最佳音轨：ffmpeg 就绪时不额外打扰，只缺组件时提示 -->
      <template v-if="selectedIsVideoOnly && !componentStore.ffmpeg.available">
        <div class="ffmpeg-row">
          <span class="stream-note">
            {{ !componentStore.ffmpeg.checked
              ? t('newTask.streamFfmpegChecking')
              : componentStore.ffmpeg.installable
                ? t('newTask.streamFfmpegRequired')
                : t('newTask.streamFfmpegManual') }}
          </span>
          <n-button size="tiny" quaternary type="primary" @click="openComponentSettings">
            {{ t('newTask.openComponentSettings') }}
          </n-button>
        </div>
      </template>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import { useUiStore } from '@/stores/uiStore'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useStreamTaskStore } from '@/stores/streamTaskStore'
import { useComponentStore } from '@/stores/componentStore'

/**
 * 流媒体下载页（yt-dlp）。
 *
 * 两种下载路径：
 * - 合成格式（视频+音频）：仍然只取直链交给 aria2，享受队列与多线程；
 * - 分离格式（B 站等）：交给 yt-dlp 下载并合并最佳音轨（需要 ffmpeg）。
 *
 * 组件（yt-dlp / ffmpeg）的检测与安装统一在「设置 → 工具与扩展」，
 * 本页只读取共享状态并提示；未安装时引导用户去设置页。
 *
 * 与另外三页不同，这里**不走 useNewTaskSubmit 的提交骨架**：
 * 它没有表单校验、不做连接校验（由 addUri 自身报错），并有独立的两段式流程
 * （先解析格式、再下载）。保持原实现的行为不变。
 */

const { t } = useI18n()
const uiStore = useUiStore()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const streamTaskStore = useStreamTaskStore()
const componentStore = useComponentStore()

const streamUrl = ref('')
const streamFetching = ref(false)
const streamDownloading = ref(false)
const streamFormats = ref<Array<{ formatId: string; ext: string; resolution: string; filesize: number | null; vcodec: string; acodec: string; note: string }>>([])
const selectedFormatId = ref<string | null>(null)
const streamTitle = ref('')

/** yt-dlp 下载模式（分离音视频格式）：发起后由 streamTaskStore 跟踪并显示在任务列表 */
const streamStarting = ref(false)

onMounted(() => {
  // 组件检测与安装都收敛到「设置 → 工具与扩展」，这里只复用共享状态
  void componentStore.checkYtdlp()
  void componentStore.checkFfmpeg()
})

const streamFormatOptions = computed(() =>
  streamFormats.value.map(f => {
    // 音轨有无必须写在选项里：B 站等站点只有分离流，选到纯视频会"下完没声音"
    const kind = f.vcodec === 'none'
      ? t('newTask.streamKindAudioOnly')
      : f.acodec === 'none'
        ? t('newTask.streamKindVideoOnly')
        : t('newTask.streamKindVideoAudio')
    return {
      label: `${f.resolution || f.ext} · ${kind}${f.note ? ` (${f.note})` : ''}${f.filesize ? ` - ${Math.round(f.filesize / 1024 / 1024)}MB` : ''}`,
      value: f.formatId
    }
  })
)

const selectedFormat = computed(() =>
  streamFormats.value.find(f => f.formatId === selectedFormatId.value) ?? null
)

/** 当前选中格式只有视频没有音轨（需要 yt-dlp 下载并合并） */
const selectedIsVideoOnly = computed(() => {
  const format = selectedFormat.value
  return !!format && format.vcodec !== 'none' && format.acodec === 'none'
})

async function fetchStreamInfo() {
  if (!streamUrl.value.trim() || !window.electronAPI?.ytdlpVideoInfo) return
  streamFetching.value = true
  streamFormats.value = []
  selectedFormatId.value = null
  try {
    const result = await window.electronAPI.ytdlpVideoInfo(streamUrl.value.trim())
    if (result.success && result.info) {
      streamTitle.value = result.info.title
      streamFormats.value = result.info.formats
      // 优先选"视频+音频"合成格式（能直接得到有声音的文件）；
      // 站点只提供分离流时（如 B 站）退回最后一个格式，并在下方明确提示
      const combined = streamFormats.value.filter(f => f.vcodec !== 'none' && f.acodec !== 'none')
      selectedFormatId.value =
        combined[combined.length - 1]?.formatId
        ?? streamFormats.value[streamFormats.value.length - 1]?.formatId
        ?? null
    } else {
      message.error(result.error || t('newTask.streamParseFailed'))
    }
  } catch {
    message.error(t('newTask.streamParseFailed'))
  } finally {
    streamFetching.value = false
  }
}

/** 下载保存目录：设置里的任务目录，未配置时用系统下载目录 */
async function resolveOutputDir(): Promise<string> {
  const base = settingsStore.taskBaseDir
  if (base) return base
  try {
    const info = await window.electronAPI?.getDefaultDownloadDir?.()
    return info?.path ?? ''
  } catch {
    return ''
  }
}

async function handleStreamDownload() {
  const format = selectedFormat.value
  if (!selectedFormatId.value || !format) return

  // 分离的视频流：交给 yt-dlp 下载并合并最佳音轨（直链无法自带音频）
  if (format.vcodec !== 'none' && format.acodec === 'none') {
    await startStreamModeDownload()
    return
  }

  if (!window.electronAPI?.ytdlpFormatUrl) return
  streamDownloading.value = true
  try {
    const result = await window.electronAPI.ytdlpFormatUrl(streamUrl.value.trim(), selectedFormatId.value)
    if (result.success && result.downloadUrl) {
      const options: Record<string, string | string[]> = {}
      if (result.title) options.out = `${sanitizeFileName(result.title)}.${result.ext || 'mp4'}`
      const baseDir = settingsStore.taskBaseDir
      if (baseDir) options.dir = baseDir
      // 直链通常校验 Referer/User-Agent（Bilibili 等），缺了这些请求头 aria2 会 403。
      // 请求头由 yt-dlp 给出，原样转成 aria2 的 `header` 数组（可重复选项）。
      const headerLines = Object.entries(result.httpHeaders ?? {})
        .map(([name, value]) => `${name}: ${value}`)
      if (headerLines.length > 0) options.header = headerLines
      await taskStore.addUri([result.downloadUrl], options)
      message.success(t('newTask.addedCount', { count: 1 }))
      uiStore.closeNewTask()
    } else {
      message.error(result.error || t('newTask.streamParseFailed'))
    }
  } catch {
    message.error(t('newTask.streamParseFailed'))
  } finally {
    streamDownloading.value = false
  }
}

/** 启动 yt-dlp 下载模式：任务进入「下载任务」列表，进度/取消都在列表里操作 */
async function startStreamModeDownload() {
  if (!window.electronAPI?.streamDownloadStart || streamStarting.value) return
  const outputDir = await resolveOutputDir()
  if (!outputDir) {
    message.error(t('newTask.streamNoDir'))
    return
  }

  streamStarting.value = true
  try {
    const result = await streamTaskStore.startTask({
      url: streamUrl.value.trim(),
      formatId: selectedFormatId.value ?? '',
      merge: true,
      outputDir,
      title: streamTitle.value
    })
    if (!result.success) {
      if (result.code === 'ffmpeg_missing') {
        message.warning(t('newTask.streamFfmpegRequired'))
        await componentStore.checkFfmpeg(true)
      } else {
        message.error(result.error || t('newTask.streamParseFailed'))
      }
      return
    }
    message.success(t('newTask.streamAddedToList'))
    uiStore.closeNewTask()
  } finally {
    streamStarting.value = false
  }
}

/** 组件安装入口在设置页：关闭新建任务弹窗并直接打开「工具与扩展」页 */
function openComponentSettings() {
  uiStore.closeNewTask()
  uiStore.openSettings('components')
}

/** 重置本页：清空链接、解析结果与已选画质 */
function handleReset() {
  streamUrl.value = ''
  streamFormats.value = []
  selectedFormatId.value = null
  streamTitle.value = ''
}

// 按钮由弹窗 footer 统一渲染（开始下载在解析格式后才可用）
defineExpose({
  submit: handleStreamDownload,
  reset: handleReset,
  submitting: computed(() => streamDownloading.value || streamStarting.value),
  actionVisible: true,
  actionDisabled: computed(() =>
    !selectedFormatId.value
    || (selectedIsVideoOnly.value && !componentStore.ffmpeg.available)
    || streamDownloading.value
    || streamStarting.value
  ),
  actionLabel: computed(() => t('newTask.startDownload'))
})

/**
 * 把视频标题收敛成纯文件名（aria2 的 out 必须是相对路径的文件名）。
 * 去除路径成分、控制符与 Windows 非法字符；全角标点（如「？」）本身合法，保留。
 */
function sanitizeFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() || ''
  let cleaned = ''
  for (const ch of last) {
    if (ch.charCodeAt(0) <= 0x1f || '<>:"|?*'.includes(ch)) continue
    cleaned += ch
  }
  return cleaned.trim() || 'stream'
}
</script>

<style scoped>
.ytdlp-checking {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.stream-note {
  margin: -4px 0 8px;
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.85;
}

.ffmpeg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.ffmpeg-row .stream-note {
  margin: 0;
}
</style>
