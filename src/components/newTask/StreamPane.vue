<template>
  <n-alert v-if="!ytdlpAvailable" type="warning" :bordered="false" style="margin-bottom: 12px;">
    {{ t('newTask.streamUrlTip') }}
  </n-alert>

  <!-- 未安装：按需下载（仅一次，安装到本机 userData；不增加安装包体积） -->
  <div v-if="!ytdlpAvailable" class="ytdlp-install">
    <p class="ytdlp-install-hint">
      {{ ytdlpInstallable ? t('newTask.streamYtdlpInstallHint') : t('newTask.streamYtdlpUnsupported') }}
    </p>
    <n-button
      v-if="ytdlpInstallable"
      type="primary"
      :loading="ytdlpInstalling"
      :disabled="ytdlpInstalling"
      @click="installYtdlp"
    >
      {{ ytdlpInstalling
        ? t('newTask.streamYtdlpInstalling')
        : t('newTask.streamYtdlpInstall', { size: ytdlpApproxSizeMB ?? '—' }) }}
    </n-button>
    <n-progress
      v-if="ytdlpInstalling && ytdlpInstallPercent > 0"
      type="line"
      :percentage="ytdlpInstallPercent"
      :height="6"
      style="margin-top: 10px;"
    />
  </div>

  <template v-else>
    <!-- 检测到的 yt-dlp 版本：放在**可用**分支才可达——
         检测不通过时后端不返回 version（只有 available:false + error），
         此前把它渲染在告警分支里，那行永远不会出现。 -->
    <div v-if="ytdlpVersion" class="ytdlp-detected">
      {{ t('newTask.streamYtdlpVersion', { version: ytdlpVersion }) }}
    </div>
    <n-form>
      <n-form-item :label="t('newTask.urisLabel')" label-placement="top">
        <n-input
          v-model:value="streamUrl"
          :placeholder="t('newTask.streamUrlPlaceholder')"
          @keyup.enter="fetchStreamInfo"
        />
      </n-form-item>
      <n-button type="primary" :loading="streamFetching" :disabled="!streamUrl.trim()" @click="fetchStreamInfo">
        {{ t('newTask.streamSelectFormat') }}
      </n-button>
    </n-form>

    <div v-if="streamFormats.length > 0" style="margin-top: 16px;">
      <n-form-item :label="t('newTask.streamSelectFormat')" label-placement="top">
        <n-select
          v-model:value="selectedFormatId"
          :options="streamFormatOptions"
        />
      </n-form-item>
      <div class="form-actions">
        <n-button type="primary" :loading="streamDownloading" :disabled="!selectedFormatId" @click="handleStreamDownload">
          {{ t('newTask.streamDownload') }}
        </n-button>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import { useUiStore } from '@/stores/uiStore'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * 流媒体下载页（yt-dlp）。
 *
 * 与另外三页不同，这里**不走 useNewTaskSubmit 的提交骨架**：
 * 它没有表单校验、不做连接校验（由 addUri 自身报错），并有独立的两段式流程
 * （先解析格式、再下载）。保持原实现的行为不变。
 */

const { t } = useI18n()
const uiStore = useUiStore()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()

const ytdlpAvailable = ref(false)
const ytdlpVersion = ref('')
const ytdlpInstallable = ref(false)
const ytdlpApproxSizeMB = ref<number | null>(null)
const ytdlpInstalling = ref(false)
const ytdlpInstallPercent = ref(0)
/** 取消安装进度订阅（组件卸载时调用，避免弹窗反复打开累积监听器） */
let unsubscribeProgress: (() => void) | null = null
const streamUrl = ref('')
const streamFetching = ref(false)
const streamDownloading = ref(false)
const streamFormats = ref<Array<{ formatId: string; ext: string; resolution: string; filesize: number | null; note: string }>>([])
const selectedFormatId = ref<string | null>(null)
const streamTitle = ref('')

const streamFormatOptions = computed(() =>
  streamFormats.value.map(f => ({
    label: `${f.resolution || f.ext} ${f.note ? `(${f.note})` : ''} ${f.filesize ? ` - ${Math.round(f.filesize / 1024 / 1024)}MB` : ''}`,
    value: f.formatId
  }))
)

// 检查 yt-dlp 是否可用（决定显示表单还是"按需下载"按钮）
async function checkAvailable() {
  if (!window.electronAPI?.ytdlpCheck) return
  try {
    const result = await window.electronAPI.ytdlpCheck()
    ytdlpAvailable.value = result.available
    ytdlpVersion.value = result.version ?? ''
    ytdlpInstallable.value = result.installable === true
    ytdlpApproxSizeMB.value = result.approxSizeMB ?? null
  } catch { /* 忽略 */ }
}

onMounted(async () => {
  // 进度是独立事件通道（invoke 只返回最终结果）
  if (window.electronAPI?.onYtdlpInstallProgress) {
    unsubscribeProgress = window.electronAPI.onYtdlpInstallProgress((progress) => {
      ytdlpInstallPercent.value = progress.percent ?? 0
    })
  }
  await checkAvailable()
})

onUnmounted(() => {
  unsubscribeProgress?.()
  unsubscribeProgress = null
})

/**
 * 一键下载 yt-dlp：主进程负责下载、SHA-256 校验与安装，
 * 成功后重新探测，表单直接在下方出现（无需重启应用）。
 */
async function installYtdlp() {
  if (!window.electronAPI?.ytdlpInstall || ytdlpInstalling.value) return
  ytdlpInstalling.value = true
  ytdlpInstallPercent.value = 0
  try {
    const result = await window.electronAPI.ytdlpInstall()
    if (result.success) {
      message.success(t('newTask.streamYtdlpInstallSuccess', { version: result.version || '—' }))
      await checkAvailable()
    } else {
      message.error(t('newTask.streamYtdlpInstallFailed', { error: result.error || '' }))
    }
  } catch (error) {
    message.error(t('newTask.streamYtdlpInstallFailed', {
      error: error instanceof Error ? error.message : String(error)
    }))
  } finally {
    ytdlpInstalling.value = false
    ytdlpInstallPercent.value = 0
  }
}

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
      // 自动选择最佳格式（列表非空已判断，`?.` 只是满足 noUncheckedIndexedAccess）
      if (streamFormats.value.length > 0) {
        selectedFormatId.value = streamFormats.value[streamFormats.value.length - 1]?.formatId ?? null
      }
    } else {
      message.error(result.error || t('newTask.streamParseFailed'))
    }
  } catch {
    message.error(t('newTask.streamParseFailed'))
  } finally {
    streamFetching.value = false
  }
}

async function handleStreamDownload() {
  if (!selectedFormatId.value || !window.electronAPI?.ytdlpFormatUrl) return
  streamDownloading.value = true
  try {
    const result = await window.electronAPI.ytdlpFormatUrl(streamUrl.value.trim(), selectedFormatId.value)
    if (result.success && result.downloadUrl) {
      const options: Record<string, string> = {}
      if (result.title) options.out = `${result.title}.${result.ext || 'mp4'}`
      const baseDir = settingsStore.taskBaseDir
      if (baseDir) options.dir = baseDir
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
</script>

<style scoped>
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.ytdlp-detected {
  margin-bottom: 8px;
  font-size: 11.5px;
  opacity: 0.85;
}

.ytdlp-install {
  margin-bottom: 12px;
}

.ytdlp-install-hint {
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.85;
}
</style>
