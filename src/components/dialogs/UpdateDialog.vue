<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="t('generalSettings.startupUpdatePrompt', { version: uiStore.updateVersion })"
    style="width: 520px"
    :mask-closable="closable"
    :closable="closable"
  >
    <div class="update-dialog">
      <!-- 更新日志始终保留展示（下载过程中也不隐藏） -->
      <div v-if="uiStore.updateNotes" class="update-notes">
        <div class="update-notes-title">{{ t('generalSettings.updateNotesTitle') }}</div>
        <!-- 内容来自本项目 GitHub Releases 的 atom 订阅源（已净化），v-html 渲染富文本 -->
        <div class="update-notes-body" v-html="sanitizedNotes"/>
      </div>

      <template v-if="uiStore.updateDialogState === 'prompt'">
        <div class="update-dialog-actions">
          <n-button @click="visible = false">{{ t('generalSettings.updateLater') }}</n-button>
          <n-button type="primary" :loading="starting" @click="startUpdateDownload">
            {{ t('generalSettings.updateNow') }}
          </n-button>
        </div>
      </template>
      <template v-else-if="uiStore.updateDialogState === 'downloading'">
        <n-progress type="line" :percentage="uiStore.updatePercent" :show-indicator="true" />
        <div class="update-downloading-text">
          {{ t('generalSettings.updateDownloading', { percent: uiStore.updatePercent }) }}
        </div>
      </template>
      <template v-else>
        <div class="update-downloaded-text">{{ t('generalSettings.updateDownloaded') }}</div>
        <div class="update-dialog-actions">
          <n-button @click="visible = false">{{ t('generalSettings.updateLater') }}</n-button>
          <n-button type="primary" @click="restartToUpdate">{{ t('generalSettings.restartToUpdate') }}</n-button>
        </div>
      </template>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/uiStore'
import { confirm } from '@/utils/feedback'
import type { UpdateStatus } from '@/types/electron'

/** GitHub Releases 页面地址（下载失败时引导用户手动下载） */
const GITHUB_RELEASES_URL = 'https://github.com/Young-ZJ66/Aria2Desktop/releases'

const uiStore = useUiStore()
const { t } = useI18n()

const visible = computed({
  get: () => uiStore.showUpdateDialog,
  set: (value: boolean) => {
    if (value) uiStore.openUpdateDialog({
      version: uiStore.updateVersion,
      notes: uiStore.updateNotes,
      state: uiStore.updateDialogState
    })
    else uiStore.closeUpdateDialog()
  }
})

const starting = ref(false)

// 下载更新过程中禁止关闭对话框（mask/右上角关闭按钮均禁用），避免误关中断下载
const closable = computed(() => uiStore.updateDialogState !== 'downloading')

/**
 * 净化 GitHub Releases 的更新日志 HTML：
 * 移除脚本类标签、内联事件与 javascript: 链接，仅保留排版标签
 */
const sanitizedNotes = computed(() => sanitizeHtml(uiStore.updateNotes))

function sanitizeHtml(html: string): string {
  if (!html) return ''
  let result = html
  // 移除成对出现的危险标签及其内容
  result = result.replace(/<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1\s*>/gi, '')
  // 移除未闭合的危险标签（如 <script ...> 后被截断）
  result = result.replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, '')
  // 移除内联事件属性（on*="..." / on*'...'）
  result = result.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // 移除 javascript: 协议的 href/src
  result = result.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
  return result
}

let unsubscribeUpdateStatus: (() => void) | null = null

onMounted(() => {
  // 监听主进程推送的下载进度，驱动弹窗状态
  // （下载失败不再经由 error 状态推送，统一由 startUpdateDownload 的返回值处理）
  if (window.electronAPI?.onUpdateStatus) {
    unsubscribeUpdateStatus = window.electronAPI.onUpdateStatus((status: UpdateStatus) => {
      if (status.state === 'downloading') {
        uiStore.updateDialogState = 'downloading'
        uiStore.updatePercent = Math.round(status.percent ?? 0)
      } else if (status.state === 'downloaded') {
        uiStore.updateDialogState = 'downloaded'
      }
    })
  }
})

onUnmounted(() => {
  unsubscribeUpdateStatus?.()
})

// 发起下载更新
async function startUpdateDownload() {
  if (!window.electronAPI?.downloadUpdate) return
  starting.value = true
  uiStore.updateDialogState = 'downloading'
  uiStore.updatePercent = 0
  const result = await window.electronAPI.downloadUpdate()
  starting.value = false
  if (!result.success) {
    // 下载失败：回到确认页（可重试），并展示失败原因与 GitHub 手动下载指引
    uiStore.updateDialogState = 'prompt'
    confirm({
      type: 'error',
      title: t('generalSettings.updateFailedTitle'),
      content: t('generalSettings.updateDownloadFailed', { error: result.error || t('settings.unknownError') }),
      // 确认（蓝色）：前往 GitHub 下载；取消（灰底）：重试，右上角可关闭
      positiveText: t('generalSettings.goToReleasePage'),
      negativeText: t('common.retry'),
      onPositiveClick: () => {
        // 经主进程 setWindowOpenHandler 协议白名单校验后交给系统浏览器打开
        window.open(GITHUB_RELEASES_URL, '_blank', 'noopener')
      },
      onNegativeClick: () => {
        // 重试下载
        startUpdateDownload()
      }
    })
  }
}

// 重启更新
function restartToUpdate() {
  window.electronAPI?.restartAndInstall?.()
}
</script>

<style scoped>
.update-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

.update-notes {
  margin-bottom: 12px;
}

.update-notes-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.update-notes-body {
  padding: 10px 12px;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.7;
  word-break: break-word;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

/* 渲染 GitHub Releases 富文本的基础排版 */
.update-notes-body :deep(h1),
.update-notes-body :deep(h2),
.update-notes-body :deep(h3) {
  margin: 8px 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.update-notes-body :deep(ul),
.update-notes-body :deep(ol) {
  margin: 4px 0;
  padding-left: 20px;
}

.update-notes-body :deep(li) {
  margin: 2px 0;
}

.update-notes-body :deep(p) {
  margin: 6px 0;
}

.update-notes-body :deep(a) {
  color: var(--primary-color, #4f6ef2);
}

.update-notes-body :deep(code) {
  padding: 1px 4px;
  font-size: 11px;
  border-radius: 4px;
  background: var(--bg-tertiary, rgba(128, 128, 128, 0.15));
}

.update-notes-body :deep(img) {
  max-width: 100%;
}

.update-downloading-text,
.update-downloaded-text {
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
