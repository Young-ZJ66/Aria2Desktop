<template>
  <n-alert v-if="!ytdlpAvailable" type="warning" :bordered="false" style="margin-bottom: 12px;">
    {{ t('newTask.streamUrlTip') }}
  </n-alert>
  <template v-else>
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
import { computed, onMounted, ref } from 'vue'
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

// 检查 yt-dlp 是否可用（决定显示提示还是表单）
onMounted(async () => {
  if (window.electronAPI?.ytdlpCheck) {
    try {
      const result = await window.electronAPI.ytdlpCheck()
      ytdlpAvailable.value = result.available
    } catch { /* 忽略 */ }
  }
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
      // 自动选择最佳格式（列表非空已判断，`?.` 只是满足 noUncheckedIndexedAccess）
      if (streamFormats.value.length > 0) {
        selectedFormatId.value = streamFormats.value[streamFormats.value.length - 1]?.formatId ?? null
      }
    } else {
      message.error(result.error || t('newTask.streamParseFailed'))
    }
  } catch (error) {
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
  } catch (error) {
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
</style>
