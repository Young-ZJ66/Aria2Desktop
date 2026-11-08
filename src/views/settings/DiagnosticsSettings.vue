<template>
  <div class="diagnostics-page">
    <div class="diagnostics-header">
      <div>
        <h3 class="diagnostics-title">{{ t('settings.diagnostics.title') }}</h3>
        <p class="diagnostics-desc">{{ t('settings.diagnostics.description') }}</p>
        <p v-if="lastRun" class="diagnostics-time">{{ t('settings.diagnostics.generatedAt', { time: lastRun }) }}</p>
      </div>
      <div class="diagnostics-actions">
        <n-button size="small" :loading="running" @click="runDiagnostics">
          {{ running ? t('settings.diagnostics.running') : t('settings.diagnostics.rerun') }}
        </n-button>
        <n-button size="small" :disabled="checks.length === 0" @click="copyReport">
          {{ t('settings.diagnostics.copy') }}
        </n-button>
        <n-button size="small" type="primary" :disabled="checks.length === 0" @click="exportReport">
          {{ t('settings.diagnostics.export') }}
        </n-button>
      </div>
    </div>

    <DismissibleAlert v-if="summary" storage-key="settings.diagnostics.summary" :type="summaryType" :show-icon="true" class="diagnostics-summary">
      {{ summary }}
    </DismissibleAlert>

    <div class="diagnostics-list">
      <div v-for="check in checks" :key="check.id" class="diagnostic-row" :class="['diagnostic-row', 'diagnostic-' + check.status]">
        <n-tag :type="tagType(check.status)" size="small" round>{{ statusText(check.status) }}</n-tag>
        <div class="diagnostic-body">
          <div class="diagnostic-label">{{ check.label }}</div>
          <div class="diagnostic-detail">{{ check.detail }}</div>
          <div v-if="check.hint" class="diagnostic-hint">{{ check.hint }}</div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NTag, useMessage } from 'naive-ui'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { taskPersistenceService } from '@/services/taskPersistenceService'
import { ensureMinimumDuration } from '@/composables/useMinimumLoading'

type CheckStatus = 'pass' | 'warn' | 'fail' | 'info'

interface DiagnosticCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  hint?: string
}

const { t } = useI18n()
const message = useMessage()

function desktopApi(): NonNullable<Window['electronAPI']> {
  return window.electronAPI!
}
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()

const running = ref(false)
const checks = ref<DiagnosticCheck[]>([])
const lastRun = ref('')

const summary = computed(() => {
  if (!checks.value.length) return ''
  const failed = checks.value.filter(c => c.status === 'fail').length
  const warned = checks.value.filter(c => c.status === 'warn').length
  if (failed === 0 && warned === 0) return t('settings.diagnostics.allGood')
  return t('settings.diagnostics.issuesFound', { failed, warned })
})

const summaryType = computed(() => {
  if (checks.value.some(c => c.status === 'fail')) return 'error'
  if (checks.value.some(c => c.status === 'warn')) return 'warning'
  return 'success'
})

function statusText(status: CheckStatus): string {
  return t(`settings.diagnostics.status.${status}`)
}

function tagType(status: CheckStatus): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'pass') return 'success'
  if (status === 'warn') return 'warning'
  if (status === 'fail') return 'error'
  return 'default'
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function isLoopback(host: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(host)
}

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function runDiagnostics() {
  running.value = true
  const startedAt = Date.now()
  const result: DiagnosticCheck[] = []
  try {
    // 应用信息
    const version = await safe(() => desktopApi().getAppVersion())
    result.push({
      id: 'app',
      label: t('settings.diagnostics.appInfo'),
      status: 'info',
      detail: version.ok ? String(version.value) : t('settings.diagnostics.unknown'),
      hint: `${desktopApi().platform} · ${navigator.userAgent}`
    })

    // 内置引擎状态
    const engine = await safe(() => desktopApi().aria2.getStatus())
    if (engine.ok && engine.value.isRunning) {
      result.push({
        id: 'engine',
        label: t('settings.diagnostics.engineStatus'),
        status: 'pass',
        detail: t('settings.diagnostics.engineRunning', { pid: engine.value.pid ?? '-' })
      })
    } else {
      result.push({
        id: 'engine',
        label: t('settings.diagnostics.engineStatus'),
        status: 'fail',
        detail: engine.ok ? t('settings.diagnostics.engineStopped') : engine.error
      })
    }

    // RPC 连接与版本
    if (connectionStore.service) {
      const ver = await safe(() => connectionStore.service!.getVersion())
      if (ver.ok) {
        result.push({
          id: 'rpc',
          label: t('settings.diagnostics.rpcConnection'),
          status: 'pass',
          detail: t('settings.diagnostics.rpcConnected', { version: ver.value.version ?? '' })
        })
        const stat = await safe(() => connectionStore.service!.getGlobalStat())
        if (stat.ok) {
          result.push({
            id: 'global-stat',
            label: t('settings.diagnostics.globalStat'),
            status: 'pass',
            detail: t('settings.diagnostics.globalStatDetail', {
              download: formatBytes(Number(stat.value.downloadSpeed) || 0),
              upload: formatBytes(Number(stat.value.uploadSpeed) || 0),
              active: stat.value.numActive,
              waiting: stat.value.numWaiting,
              stopped: stat.value.numStopped
            })
          })
        }
      } else {
        result.push({
          id: 'rpc',
          label: t('settings.diagnostics.rpcConnection'),
          status: 'fail',
          detail: t('settings.diagnostics.rpcFailed', { error: ver.error }),
          hint: t('settings.diagnostics.rpcHint')
        })
      }
    } else {
      result.push({
        id: 'rpc',
        label: t('settings.diagnostics.rpcConnection'),
        status: 'warn',
        detail: t('settings.diagnostics.rpcNotConnected')
      })
    }

    // 下载目录与磁盘空间
    const dir = settingsStore.settings?.download?.defaultDir || ''
    if (dir) {
      const space = await safe(() => desktopApi().getDiskFreeSpace(dir))
      if (space.ok && space.value.free >= 0) {
        const free = formatBytes(space.value.free)
        result.push({
          id: 'download-dir',
          label: t('settings.diagnostics.downloadDir'),
          status: space.value.free > 1024 * 1024 * 1024 ? 'pass' : 'warn',
          detail: t('settings.diagnostics.dirFree', { dir, free }),
          hint: space.value.free <= 1024 * 1024 * 1024 ? t('settings.diagnostics.lowDisk') : undefined
        })
      } else {
        result.push({
          id: 'download-dir',
          label: t('settings.diagnostics.downloadDir'),
          status: 'warn',
          detail: t('settings.diagnostics.dirUnavailable', { dir }),
          hint: space.ok ? undefined : space.error
        })
      }
    }

    // 安全配置
    const active = connectionStore.config
    const securityIssues: string[] = []
    if (!active.secret) securityIssues.push(t('settings.diagnostics.secretMissing'))
    if (active.protocol === 'http' && !isLoopback(active.host)) securityIssues.push(t('settings.diagnostics.insecureHttp'))
    result.push({
      id: 'security',
      label: t('settings.diagnostics.security'),
      status: securityIssues.length ? 'warn' : 'pass',
      detail: securityIssues.length ? securityIssues.join('；') : t('settings.diagnostics.secretOk'),
      hint: securityIssues.length ? t('settings.diagnostics.securityHint') : undefined
    })

    // UPnP
    if (settingsStore.settings?.bt?.upnpEnabled) {
      const upnp = await safe(() => desktopApi().getUpnpStatus())
      const mapped = upnp.ok && upnp.value.state === 'ok'
      result.push({
        id: 'upnp',
        label: t('settings.diagnostics.upnp'),
        status: mapped ? 'pass' : 'warn',
        detail: mapped
          ? t('settings.diagnostics.upnpMapped', { ip: upnp.ok ? (upnp.value.externalIp || '-') : '-' })
          : (upnp.ok && upnp.value.message ? upnp.value.message : t('settings.diagnostics.upnpNotMapped'))
      })
    } else {
      result.push({ id: 'upnp', label: t('settings.diagnostics.upnp'), status: 'info', detail: t('settings.diagnostics.upnpDisabled') })
    }

    // Tracker 订阅
    const tracker = await safe(() => desktopApi().tracker.getStatus())
    if (tracker.ok && tracker.value.success) {
      result.push({
        id: 'tracker',
        label: t('settings.diagnostics.tracker'),
        status: tracker.value.lastUpdate ? 'pass' : 'info',
        detail: tracker.value.lastUpdate
          ? t('settings.diagnostics.trackerDetail', { count: tracker.value.lastCount ?? 0, time: tracker.value.lastUpdate })
          : t('settings.diagnostics.trackerNever')
      })
    }

    // 插件
    const plugins = await safe(() => desktopApi().pluginsList())
    result.push({
      id: 'plugins',
      label: t('settings.diagnostics.plugins'),
      status: plugins.ok ? 'info' : 'warn',
      detail: plugins.ok
        ? t('settings.diagnostics.pluginsDetail', { total: plugins.value.length, enabled: plugins.value.filter(p => p.enabled).length })
        : (plugins as { ok: false; error: string }).error,
      hint: plugins.ok ? t('settings.diagnostics.pluginsHint') : undefined
    })

    // yt-dlp
    const ytdlp = await safe(() => desktopApi().ytdlpCheck())
    result.push({
      id: 'ytdlp',
      label: t('settings.diagnostics.ytdlp'),
      status: ytdlp.ok && ytdlp.value.available ? 'pass' : 'info',
      detail: ytdlp.ok && ytdlp.value.available
        ? t('settings.diagnostics.ytdlpAvailable', { version: ytdlp.value.version ?? '' })
        : t('settings.diagnostics.ytdlpMissing')
    })

    // 日志位置
    const logs = await safe(() => desktopApi().getLogsPath())
    result.push({
      id: 'logs',
      label: t('settings.diagnostics.logs'),
      status: logs.ok ? 'info' : 'warn',
      detail: logs.ok && logs.value.success ? (logs.value.file || logs.value.dir || '') : (logs.ok ? t('settings.diagnostics.unknown') : logs.error)
    })

    // 历史持久化
    const persistError = taskPersistenceService.getLastPersistError()
    result.push({
      id: 'history',
      label: t('settings.diagnostics.history'),
      status: persistError ? 'fail' : 'pass',
      detail: persistError ? t('settings.diagnostics.historyFailed', { error: persistError }) : t('settings.diagnostics.historyOk')
    })

    checks.value = result
    lastRun.value = new Date().toLocaleString()
  } finally {
    await ensureMinimumDuration(startedAt)
    running.value = false
  }
}

function reportPayload() {
  return {
    app: 'Aria2 Desktop',
    generatedAt: new Date().toISOString(),
    platform: desktopApi().platform,
    version: checks.value.find(c => c.id === 'app')?.detail ?? '',
    rpc: { host: connectionStore.config.host, port: connectionStore.config.port, protocol: connectionStore.config.protocol },
    checks: checks.value.map(({ id, label, status, detail, hint }) => ({ id, label, status, detail, hint }))
  }
}

async function copyReport() {
  await desktopApi().writeClipboard(JSON.stringify(reportPayload(), null, 2))
  message.success(t('settings.diagnostics.copied'))
}

function exportReport() {
  const blob = new Blob([JSON.stringify(reportPayload(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aria2-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(runDiagnostics)
</script>

<style scoped>
.diagnostics-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 16px;
}
.diagnostics-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.diagnostics-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}
.diagnostics-desc {
  margin: 0;
  color: var(--text-color-3);
  font-size: 13px;
}
.diagnostics-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.diagnostics-summary {
  margin-top: 4px;
}
.diagnostics-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.diagnostic-row {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--card-color);
}
.diagnostic-row.diagnostic-fail {
  border-color: rgba(208, 48, 80, 0.35);
}
.diagnostic-row.diagnostic-warn {
  border-color: rgba(240, 160, 32, 0.35);
}
.diagnostic-body {
  min-width: 0;
}
.diagnostic-label {
  font-weight: 600;
  font-size: 13px;
}
.diagnostic-detail {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-color-2);
  word-break: break-all;
}
.diagnostic-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-color-3);
}
.diagnostics-time {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-color-3);
}
</style>
