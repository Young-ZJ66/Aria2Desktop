<template>
  <!-- 组件检测/安装在「设置 → 工具与扩展」；完成检测前只显示检测中，避免闪出未安装 -->
  <div v-if="!componentStore.ytdlp.checked" class="ytdlp-checking">
    <n-spin size="small" />
    <span>{{ t('newTask.streamChecking') }}</span>
  </div>

  <template v-else-if="!componentStore.ytdlp.available">
    <DismissibleAlert storage-key="newTask.streamTip" type="warning" style="margin-bottom: 12px;">
      {{ t('newTask.streamUrlTip') }}
    </DismissibleAlert>
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
          <!-- 列表按钮常驻：链接是不是列表页只有 yt-dlp 知道，由用户显式选择 -->
          <n-button
            :loading="playlistFetching"
            :disabled="!streamUrl.trim() || streamDownloading || streamStarting"
            @click="fetchPlaylistInfo(false)"
          >
            {{ t('newTask.streamPlaylist') }}
          </n-button>
        </n-input-group>
      </n-form-item>
    </n-form>

    <!-- 播放列表条目：勾选要下载的条目，下载整单交给 yt-dlp 按条目序号执行 -->
    <div v-if="playlistInfo" class="playlist-section">
      <div class="playlist-header">
        <span class="playlist-title" :title="playlistInfo.title">
          {{ playlistInfo.title }} · {{ selectedPlaylistKeys.size }}/{{ playlistInfo.count }}
        </span>
        <n-button
          size="tiny"
          quaternary
          type="primary"
          :disabled="streamDownloading || streamStarting"
          @click="togglePlaylistSelectAll"
        >
          {{ allPlaylistSelected ? t('newTask.streamPlaylistDeselectAll') : t('newTask.streamPlaylistSelectAll') }}
        </n-button>
      </div>
      <div class="playlist-list">
        <div
          v-for="(entry, i) in playlistInfo.entries"
          :key="entry.id + '-' + i"
          class="playlist-item"
          @click="togglePlaylistEntry(entry)"
        >
          <n-checkbox
            :checked="isPlaylistEntrySelected(entry)"
            :disabled="streamDownloading || streamStarting"
            @click.stop
            @update:checked="togglePlaylistEntry(entry)"
          />
          <span class="playlist-item-title" :title="entry.title">{{ entry.title }}</span>
          <span class="playlist-item-duration">{{ formatDuration(entry.duration) }}</span>
        </div>
      </div>
    </div>

    <div style="margin-top: 16px;">
      <n-form-item :label="t('newTask.streamPresetLabel')" label-placement="top">
        <n-select
          v-model:value="selectedPresetId"
          :options="presetOptions"
          :disabled="streamDownloading || streamStarting"
        />
      </n-form-item>

      <!-- 自定义预设：沿用「解析后选具体格式」的原路径（预设表达式已是完整 -f 值，无需再选） -->
      <template v-if="isCustomPreset">
        <n-form-item
          v-if="streamFormats.length > 0"
          :label="t('newTask.streamSelectFormat')"
          label-placement="top"
        >
          <n-select
            v-model:value="selectedFormatId"
            :options="streamFormatOptions"
            :disabled="streamDownloading || streamStarting"
          />
        </n-form-item>
        <div v-else class="stream-note">
          {{ t('newTask.streamCustomFormatHint') }}
        </div>
      </template>

      <!-- 合并音轨/转 MP3/字幕转 srt 都要 ffmpeg：就绪时不额外打扰，只缺组件时提示 -->
      <template v-if="needsFfmpeg && !componentStore.ffmpeg.available">
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

    <!-- 字幕：只有 yt-dlp 下载路径支持（aria2 直链没有字幕概念） -->
    <n-form style="margin-top: 8px;">
      <n-form-item :label="t('newTask.streamSubtitlesLabel')" label-placement="top" :show-feedback="false">
        <div class="subtitle-row">
          <n-switch v-model:value="subtitleEnabled" size="small" :disabled="streamDownloading || streamStarting" />
          <n-input
            v-model:value="subtitleLanguages"
            :placeholder="t('newTask.streamSubtitleLangsPlaceholder')"
            :disabled="!subtitleEnabled || streamDownloading || streamStarting"
            size="small"
            clearable
          />
          <n-checkbox
            v-model:checked="subtitleAuto"
            size="small"
            :disabled="!subtitleEnabled || streamDownloading || streamStarting"
          >
            {{ t('newTask.streamSubtitleAuto') }}
          </n-checkbox>
        </div>
      </n-form-item>

      <!-- Cookie 文件：需要登录态的站点（会员视频等）把浏览器导出的 cookies.txt 交给 yt-dlp -->
      <n-form-item :label="t('newTask.streamCookieLabel')" label-placement="top" :show-feedback="false" style="margin-top: 12px;">
        <div class="cookie-row">
          <n-button size="small" :disabled="streamDownloading || streamStarting" @click="pickCookieFile">
            {{ t('newTask.streamCookiePick') }}
          </n-button>
          <span class="cookie-path" :title="cookieFile">{{ cookieFile || t('newTask.streamCookieNone') }}</span>
          <n-button
            v-if="cookieFile"
            size="tiny"
            quaternary
            type="error"
            :disabled="streamDownloading || streamStarting"
            @click="cookieFile = ''"
          >
            {{ t('newTask.streamCookieClear') }}
          </n-button>
        </div>
      </n-form-item>
    </n-form>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'
import { useUiStore } from '@/stores/uiStore'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useStreamTaskStore } from '@/stores/streamTaskStore'
import { useComponentStore } from '@/stores/componentStore'
import {
  STREAM_FORMAT_PRESETS,
  STREAM_PRESET_CUSTOM,
  STREAM_PRESET_DEFAULT,
  type StreamFormatPreset
} from '@/shared/streamPresets'

/**
 * 流媒体下载页（yt-dlp）。
 *
 * 两种下载路径：
 * - 合成格式（视频+音频）：仍然只取直链交给 aria2，享受队列与多线程；
 * - 分离格式（B 站等）：交给 yt-dlp 下载并合并最佳音轨（需要 ffmpeg）。
 *
 * v1.3.6 起：画质预设（best/1080p/…）、播放列表（按条目勾选）、
 * 字幕下载与 Cookie 文件。除「自定义预设 + 合成格式」仍走 aria2 直链外，
 * 其余组合（预设表达式、列表、字幕、Cookie、转 MP3）都交给 yt-dlp 模式——
 * 这些特性 aria2 直链没有对应概念。
 *
 * 组件（yt-dlp / ffmpeg）的检测与安装统一在「设置 → 工具与扩展」，
 * 本页只读取共享状态并提示；未安装时引导用户去设置页。
 *
 * 与另外三页不同，这里**不走 useNewTaskSubmit 的提交骨架**：
 * 它没有表单校验、不做连接校验（由 addUri 自身报错），并有独立的两段式流程
 * （先解析格式、再下载）。
 */

const { t } = useI18n()
const uiStore = useUiStore()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const streamTaskStore = useStreamTaskStore()
const componentStore = useComponentStore()

/** 播放列表解析结果在本组件内的形状（与主进程 YtdlpPlaylistInfo 对齐，index 为 1 起序号） */
interface PlaylistPaneState {
  info: {
    title: string
    count: number
    entries: Array<{ id: string; title: string; url: string; duration?: number; index?: number }>
    hasPlaceholderUrls?: boolean
  }
}

/** 列表默认勾选条数：整个列表可能上千条，全选默认值容易制造意外巨量下载 */
const PLAYLIST_DEFAULT_SELECTED = 50

const streamUrl = ref('')
const streamFetching = ref(false)
const streamDownloading = ref(false)
const streamFormats = ref<Array<{ formatId: string; ext: string; resolution: string; filesize: number | null; vcodec: string; acodec: string; note: string }>>([])
const selectedFormatId = ref<string | null>(null)
const streamTitle = ref('')

/** 播放列表解析结果（null=未解析列表） */
const playlistInfo = ref<PlaylistPaneState['info'] | null>(null)
const playlistFetching = ref(false)
/** 选中条目的 key（index 优先，缺 index 用 id 兜底——flat JSON 的 playlist_index 可缺失） */
const selectedPlaylistKeys = ref<Set<string>>(new Set())

/** 画质预设：默认 best，切「自定义」后回到解析具体格式的原路径 */
const selectedPresetId = ref<string>(STREAM_PRESET_DEFAULT)

/** 字幕：enabled 才参与下载请求；语言是逗号分隔输入（如 en,zh-Hans） */
const subtitleEnabled = ref(false)
const subtitleLanguages = ref('')
const subtitleAuto = ref(false)

/** Cookie 文件（cookies.txt 绝对路径），空串=未选 */
const cookieFile = ref('')

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

/** 预设下拉：预设项 + 「自定义」（沿用解析格式列表） */
const presetOptions = computed(() => [
  ...STREAM_FORMAT_PRESETS.map(p => ({ label: t(p.label), value: p.id })),
  { label: t('newTask.streamPresetCustom'), value: STREAM_PRESET_CUSTOM }
])

const isCustomPreset = computed(() => selectedPresetId.value === STREAM_PRESET_CUSTOM)

/** 当前预设对象（自定义时为 null） */
const selectedPreset = computed<StreamFormatPreset | null>(() =>
  STREAM_FORMAT_PRESETS.find(p => p.id === selectedPresetId.value) ?? null
)

/**
 * 本次下载是否需要 ffmpeg：合并音轨（预设 merge / 自定义分离视频流）、
 * 转 MP3、字幕转 srt 都是 ffmpeg 的活。用于提前提示而不是下载失败后才发现。
 */
const needsFfmpeg = computed(() => {
  if (isCustomPreset.value) return selectedIsVideoOnly.value
  const preset = selectedPreset.value
  if (!preset) return false
  return preset.merge || preset.extractAudio === true || subtitleEnabled.value
})

/** 播放列表条目的稳定 key：优先 yt-dlp 给的 playlist_index（下载请求也按它选条目） */
function playlistEntryKey(entry: { id: string; index?: number }): string {
  return entry.index !== undefined && entry.index !== null ? String(entry.index) : `v:${entry.id}`
}

const allPlaylistSelected = computed(() =>
  !!playlistInfo.value && playlistInfo.value.entries.length > 0
  && playlistInfo.value.entries.every(entry => selectedPlaylistKeys.value.has(playlistEntryKey(entry)))
)

function isPlaylistEntrySelected(entry: { id: string; index?: number }): boolean {
  return selectedPlaylistKeys.value.has(playlistEntryKey(entry))
}

function togglePlaylistEntry(entry: { id: string; index?: number }): void {
  const key = playlistEntryKey(entry)
  const next = new Set(selectedPlaylistKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedPlaylistKeys.value = next
}

function togglePlaylistSelectAll(): void {
  if (!playlistInfo.value) return
  if (allPlaylistSelected.value) {
    selectedPlaylistKeys.value = new Set()
  } else {
    selectedPlaylistKeys.value = new Set(
      playlistInfo.value.entries.map(entry => playlistEntryKey(entry))
    )
  }
}

/** 秒 → m:ss / h:mm:ss；缺时长显示 – */
function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

async function fetchStreamInfo() {
  if (!streamUrl.value.trim() || !window.electronAPI?.ytdlpVideoInfo) return
  streamFetching.value = true
  streamFormats.value = []
  selectedFormatId.value = null
  resetPlaylistState()
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
      // 解析失败不立即报错：同一个 URL 可能是列表页（--no-playlist 模式解析不了），
      // 自动切换到列表解析兜底，仍失败才把错误亮给用户
      await fetchPlaylistInfo(true)
      if (!playlistInfo.value) {
        message.error(result.error || t('newTask.streamParseFailed'))
      }
    }
  } catch {
    await fetchPlaylistInfo(true)
    if (!playlistInfo.value) {
      message.error(t('newTask.streamParseFailed'))
    }
  } finally {
    streamFetching.value = false
  }
}

/**
 * 解析播放列表（flat 模式，不逐条取详情，速度快）。
 * fromVideoFallback=解析视频失败时的自动兜底：同样的 URL 可能是列表页，
 * 自动试一次列表解析，失败才报错。
 */
async function fetchPlaylistInfo(fromVideoFallback: boolean) {
  if (!streamUrl.value.trim() || !window.electronAPI?.ytdlpPlaylistInfo) return
  playlistFetching.value = true
  if (!fromVideoFallback) {
    // 手动触发：清掉单视频解析残留（标题/格式列表属于上一个 URL）
    streamFormats.value = []
    selectedFormatId.value = null
    streamTitle.value = ''
  }
  try {
    const result = await window.electronAPI.ytdlpPlaylistInfo(streamUrl.value.trim())
    if (result.success && result.info && result.info.entries.length > 0) {
      playlistInfo.value = result.info
      // 默认全选前 50 条：整个列表可能上千条，全选默认值容易制造意外巨量下载
      const keys = result.info.entries.slice(0, PLAYLIST_DEFAULT_SELECTED).map(entry => playlistEntryKey(entry))
      selectedPlaylistKeys.value = new Set(keys)
      // 列表页没有逐条格式信息，自定义预设失去意义，切回默认预设
      if (selectedPresetId.value === STREAM_PRESET_CUSTOM) {
        selectedPresetId.value = STREAM_PRESET_DEFAULT
      }
      if (result.info.hasPlaceholderUrls) {
        message.warning(t('newTask.streamPlaylistPlaceholderUrl'))
      }
    } else {
      playlistInfo.value = null
      selectedPlaylistKeys.value = new Set()
      if (!fromVideoFallback) {
        message.error(result.error || t('newTask.streamPlaylistEmpty'))
      }
    }
  } catch {
    if (!fromVideoFallback) message.error(t('newTask.streamPlaylistEmpty'))
  } finally {
    playlistFetching.value = false
  }
}

function resetPlaylistState(): void {
  playlistInfo.value = null
  selectedPlaylistKeys.value = new Set()
}

/** 下载请求里的 playlist.ids：传选中条目的 1 起序号（yt-dlp --playlist-items 的语义） */
function playlistRequestIds(): { ids: string[] } | undefined {
  if (!playlistInfo.value) return undefined
  const ids: string[] = []
  playlistInfo.value.entries.forEach(entry => {
    const key = playlistEntryKey(entry)
    if (!selectedPlaylistKeys.value.has(key)) return
    // --playlist-items 按序号选条目；index 缺失的条目给不出序号，跳过
    //（flat JSON 正常都带 playlist_index，这是极端兜底）
    if (entry.index !== undefined && entry.index !== null) ids.push(String(entry.index))
  })
  return ids.length > 0 ? { ids } : undefined
}

/** 字幕请求：开关关闭或没填语言时不带该字段（避免服务端把空语言列表当无效请求拒掉） */
function subtitleRequest(): { enabled: boolean; languages: string[]; includeAuto?: boolean } | undefined {
  if (!subtitleEnabled.value) return undefined
  const languages = subtitleLanguages.value
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  if (languages.length === 0) return undefined
  return { enabled: true, languages, includeAuto: subtitleAuto.value }
}

/** Cookie 文件选择：系统打开对话框，只收 txt（浏览器导出的 Netscape cookies.txt） */
async function pickCookieFile(): Promise<void> {
  if (!window.electronAPI?.showOpenDialog) return
  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openFile'],
      title: t('newTask.streamCookiePick'),
      filters: [{ name: 'cookies.txt', extensions: ['txt'] }]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      cookieFile.value = result.filePaths[0] ?? ''
    }
  } catch {
    // 对话框失败不致命：用户可重试，不打断整个表单
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
  // 播放列表：必须勾选至少一条（序号即 yt-dlp 的 --playlist-items 值）
  if (playlistInfo.value && selectedPlaylistKeys.value.size === 0) {
    message.warning(t('newTask.streamPlaylistNoneSelected'))
    return
  }

  // 自定义预设且没解析出格式：引导先解析（预设路径不需要格式解析）
  if (isCustomPreset.value && !selectedFormatId.value) {
    message.warning(t('newTask.streamParseFirst'))
    return
  }

  // 走 aria2 直链的仅剩一种组合：自定义 + 合成格式 + 无任何附加特性。
  // 其余（预设表达式/列表/字幕/Cookie/转 MP3/分离视频流）都必须 yt-dlp 执行。
  const useDirect = isCustomPreset.value
    && !!selectedFormat.value
    && selectedFormat.value.vcodec !== 'none'
    && selectedFormat.value.acodec !== 'none'
    && !playlistInfo.value
    && !subtitleEnabled.value
    && !cookieFile.value
  if (!useDirect) {
    await startStreamModeDownload()
    return
  }

  if (!window.electronAPI?.ytdlpFormatUrl) return
  const directFormatId = selectedFormatId.value
  if (!directFormatId) return
  streamDownloading.value = true
  try {
    const result = await window.electronAPI.ytdlpFormatUrl(streamUrl.value.trim(), directFormatId)
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

  // 请求格式选择器：预设直接用其表达式；自定义用解析选中的格式 id
  const preset = selectedPreset.value
  const formatId = preset ? preset.format : (selectedFormatId.value ?? '')
  // 合并音轨：预设自带 merge 语义；自定义沿用"分离视频流才合并"的旧行为
  const merge = preset ? preset.merge : true

  // 列表标题：列表模式下视频解析没跑（或失败），用列表标题命名任务
  const title = streamTitle.value || playlistInfo.value?.title || ''

  const playlist = playlistRequestIds()
  const subtitle = subtitleRequest()
  if (subtitleEnabled.value && !subtitle) {
    // 开了字幕但语言为空：明确提示而不是静默丢字幕
    message.warning(t('newTask.streamSubtitleLangsRequired'))
    return
  }

  streamStarting.value = true
  try {
    const result = await streamTaskStore.startTask({
      url: streamUrl.value.trim(),
      formatId,
      merge,
      outputDir,
      title,
      playlist,
      subtitle,
      cookieFile: cookieFile.value || undefined,
      extractAudio: preset?.extractAudio
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

/** 重置本页：清空链接、解析结果与已选画质/列表/字幕/Cookie */
function handleReset() {
  streamUrl.value = ''
  streamFormats.value = []
  selectedFormatId.value = null
  streamTitle.value = ''
  resetPlaylistState()
  selectedPresetId.value = STREAM_PRESET_DEFAULT
  subtitleEnabled.value = false
  subtitleLanguages.value = ''
  subtitleAuto.value = false
  cookieFile.value = ''
}

// 按钮由弹窗 footer 统一渲染（开始下载在解析格式后才可用）
defineExpose({
  submit: handleStreamDownload,
  reset: handleReset,
  submitting: computed(() => streamDownloading.value || streamStarting.value),
  actionVisible: true,
  actionDisabled: computed(() => {
    // 播放列表模式：勾选至少一条才可下载
    if (playlistInfo.value && selectedPlaylistKeys.value.size === 0) return true
    // 自定义预设：需要先解析并选中具体格式
    if (isCustomPreset.value && !selectedFormatId.value) return true
    // 需要 ffmpeg 的组合在组件就绪前不允许开始（错误提示已在上方展示）
    if (needsFfmpeg.value && !componentStore.ffmpeg.available) return true
    return streamDownloading.value || streamStarting.value
  }),
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

.playlist-section {
  margin-top: 12px;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  padding: 8px 10px;
}

.playlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.playlist-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 上限 500 条：固定高度滚动，避免长列表把弹窗撑出屏幕 */
.playlist-list {
  max-height: 260px;
  overflow-y: auto;
}

.playlist-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
}

.playlist-item:hover {
  background: var(--hover-color, rgba(128, 128, 128, 0.08));
}

.playlist-item-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.playlist-item-duration {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  opacity: 0.65;
}

.subtitle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.subtitle-row .n-input {
  flex: 1;
}

.cookie-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.cookie-path {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}
</style>
