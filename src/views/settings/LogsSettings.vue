<template>
  <SettingsPage
    :title="t('nav.logs')"
    :show-actions="false"
  >
    <n-card class="setting-group log-card">
      <div class="log-toolbar">
        <n-button @click="openLogDir">
          {{ t('settings.logs.openDir') }}
        </n-button>
        <n-button :loading="loading" @click="loadLogs()">
          {{ t('settings.logs.refresh') }}
        </n-button>
        <n-checkbox v-model:checked="autoRefresh">
          {{ t('settings.logs.autoRefresh') }}
        </n-checkbox>
        <n-select
          v-model:value="level"
          :options="levelOptions"
          size="small"
          class="log-level"
        />
        <n-input
          v-model:value="keyword"
          clearable
          size="small"
          :placeholder="t('settings.logs.searchPlaceholder')"
          class="log-search"
        />
      </div>

      <div class="log-meta">
        <span class="log-path">{{ t('settings.logs.filePath', { path: filePath || '—' }) }}</span>
        <span v-if="truncated" class="log-truncated">
          {{ t('settings.logs.truncated', { count: lines.length }) }}
        </span>
      </div>

      <n-spin :show="loading">
        <div ref="viewerRef" class="log-viewer">
          <div v-if="!filteredLines.length" class="log-empty">
            <UiEmpty size="sm" :icon="DocumentTextOutline" :title="t('settings.logs.empty')" />
          </div>
          <div
            v-for="(line, index) in filteredLines"
            :key="index"
            class="log-line"
            :class="lineClass(line)"
          >{{ line }}</div>
        </div>
      </n-spin>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DocumentTextOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import { UiEmpty } from '@/components/ui'

const { t } = useI18n()

/** 一次拉取的行数：既够排查近因，又不至于把界面撑爆 */
const MAX_LINES = 2000
const AUTO_REFRESH_MS = 3000

const lines = ref<string[]>([])
const filePath = ref('')
const loading = ref(false)
const truncated = ref(false)
const autoRefresh = ref(true)
const level = ref<'all' | 'info' | 'warn' | 'error'>('all')
const keyword = ref('')
const viewerRef = ref<HTMLElement | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | null = null

const levelOptions = computed(() => [
  { label: t('settings.logs.levelAll'), value: 'all' },
  { label: t('settings.logs.levelInfo'), value: 'info' },
  { label: t('settings.logs.levelWarn'), value: 'warn' },
  { label: t('settings.logs.levelError'), value: 'error' }
])

const filteredLines = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const wanted = level.value
  return lines.value.filter((line) => {
    if (wanted !== 'all') {
      const lower = line.toLowerCase()
      if (wanted === 'error' && !/(error|错误|失败)/.test(lower)) return false
      if (wanted === 'warn' && !/(warn|警告)/.test(lower)) return false
      if (wanted === 'info' && !/(info|notice)/.test(lower)) return false
    }
    return !kw || line.toLowerCase().includes(kw)
  })
})

function lineClass(line: string): string {
  const lower = line.toLowerCase()
  if (/(error|错误|失败)/.test(lower)) return 'log-line--error'
  if (/(warn|警告)/.test(lower)) return 'log-line--warn'
  return ''
}

async function loadLogs(silent = false): Promise<void> {
  if (!silent) loading.value = true
  try {
    // 用户向上翻查历史时不要强行拽回底部；只有原本就贴着底部才跟随最新日志
    const stickToBottom = !viewerRef.value
      || viewerRef.value.scrollTop + viewerRef.value.clientHeight >= viewerRef.value.scrollHeight - 4
    const result = await window.electronAPI?.readLogFile?.(MAX_LINES)
    if (!result?.success) {
      if (!silent) message.error(result?.error || t('settings.logs.loadFailed'))
      return
    }
    lines.value = result.lines ?? []
    filePath.value = result.path ?? ''
    truncated.value = result.truncated === true
    await nextTick()
    if (stickToBottom && viewerRef.value) viewerRef.value.scrollTop = viewerRef.value.scrollHeight
  } catch (error) {
    console.error('[LogsSettings] 读取日志失败:', error)
    if (!silent) message.error(t('settings.logs.loadFailed'))
  } finally {
    if (!silent) loading.value = false
  }
}

async function openLogDir(): Promise<void> {
  try {
    const result = await window.electronAPI?.openLogsDir?.()
    if (!result?.success) message.error(result?.error || t('settings.logs.openFailed'))
  } catch (error) {
    console.error('[LogsSettings] 打开日志目录失败:', error)
    message.error(t('settings.logs.openFailed'))
  }
}

function startAutoRefresh(): void {
  if (refreshTimer !== null) return
  refreshTimer = setInterval(() => {
    // 最小化/托盘驻留时不要每 3 秒唤醒主进程读日志
    if (document.visibilityState === 'visible') void loadLogs(true)
  }, AUTO_REFRESH_MS)
}

function stopAutoRefresh(): void {
  if (refreshTimer !== null) clearInterval(refreshTimer)
  refreshTimer = null
}

watch(autoRefresh, (enabled) => {
  if (enabled) startAutoRefresh()
  else stopAutoRefresh()
})

onMounted(() => {
  void loadLogs()
  if (autoRefresh.value) startAutoRefresh()
})

// keep-alive 缓存期间页面并未销毁：切走时停表，切回时恢复并补拉一次
onActivated(() => {
  if (autoRefresh.value) startAutoRefresh()
  void loadLogs(true)
})

onDeactivated(() => { stopAutoRefresh() })
onUnmounted(() => { stopAutoRefresh() })
</script>

<style scoped>
.log-card {
  margin-bottom: var(--ds-space-16);
}

.log-toolbar {
  display: flex;
  align-items: center;
  gap: var(--ds-space-12);
  flex-wrap: wrap;
  margin-bottom: var(--ds-space-10);
}

.log-level {
  width: 120px;
}

.log-search {
  width: 220px;
}

.log-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-12);
  margin-bottom: var(--ds-space-8);
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-faint);
}

.log-path {
  word-break: break-all;
}

.log-viewer {
  /* 固定高度：日志区始终在一屏内，不随行数增长把页面撑出滚动条 */
  height: calc(82vh - 240px);
  min-height: 220px;
  max-height: 760px;
  overflow: auto;
  padding: var(--ds-space-12);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-md);
  background: var(--ds-bg-surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--ds-text-small-size);
  line-height: 1.6;
}

.log-line {
  /* 2000 行日志里只有视口附近需要真正排版，降低每次刷新后的渲染成本 */
  content-visibility: auto;
  contain-intrinsic-size: auto 19px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--ds-text-base);
}

.log-line--warn {
  color: var(--ds-status-warning-text);
}

.log-line--error {
  color: var(--ds-status-danger-text);
}

.log-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
