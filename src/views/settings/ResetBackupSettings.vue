<template>
  <SettingsPage
    :title="t('nav.resetBackup')"
    :description="t('settings.resetBackup.description')"
    :show-actions="false"
  >
    <!-- 重置：把全部设置恢复为出厂默认值 -->
    <n-card :title="t('settings.resetBackup.resetTitle')" class="setting-group">
      <n-space align="center">
        <n-button :disabled="settingsStore.isLoading" @click="resetSettings">
          {{ t('generalSettings.resetSettings') }}
        </n-button>
        <span class="setting-hint">{{ t('generalSettings.resetSettingsTip') }}</span>
      </n-space>
    </n-card>

    <!-- 备份：导出/导入走主进程白名单与脱敏逻辑，导入前先预览 -->
    <n-card :title="t('settings.resetBackup.backupTitle')" class="setting-group">
      <n-checkbox v-model:checked="backupIncludeSecrets" class="backup-secrets-checkbox">
        {{ t('settings.backup.includeSecrets') }}
      </n-checkbox>
      <n-space class="backup-actions">
        <n-button :loading="backupExporting" @click="onExportSettings">
          {{ t('settings.backup.export') }}
        </n-button>
        <n-button :loading="backupImporting" @click="triggerImportSettings">
          {{ t('settings.backup.import') }}
        </n-button>
      </n-space>
      <input
        ref="backupFileInput"
        type="file"
        accept=".json,application/json"
        class="backup-file-input"
        @change="onImportFileChange"
      />
    </n-card>

    <!-- 导出密钥确认 -->
    <n-modal
      v-model:show="secretConfirmVisible"
      preset="dialog"
      type="warning"
      :title="t('settings.backup.secretConfirmTitle')"
      :content="t('settings.backup.secretConfirmBody')"
      :positive-text="t('settings.backup.export')"
      :negative-text="t('common.cancel')"
      @positive-click="doExportSettings"
    />

    <!-- 导入预览 -->
    <n-modal
      v-model:show="importReportVisible"
      preset="card"
      :title="t('settings.backup.reportTitle')"
      class="import-report-modal"
      style="width: min(640px, calc(100vw - 48px));"
    >
      <template v-if="importReport">
        <n-descriptions :column="1" label-placement="left" size="small" bordered>
          <n-descriptions-item :label="t('settings.backup.applied')">
            <span class="import-report-value">{{ importReport.applied.length }}</span>
          </n-descriptions-item>
          <n-descriptions-item v-if="importReport.skipped.length" :label="t('settings.backup.skipped')">
            <span class="import-report-value">{{ importReport.skipped.length }}</span>
          </n-descriptions-item>
          <n-descriptions-item v-if="importReport.rejected.length" :label="t('settings.backup.rejected')">
            <span class="import-report-value">{{ importReport.rejected.length }}</span>
          </n-descriptions-item>
          <n-descriptions-item v-if="importReport.preservedSecrets" :label="t('settings.backup.includeSecrets')">
            <span>{{ t('settings.backup.preservedSecrets', { count: importReport.preservedSecrets }) }}</span>
          </n-descriptions-item>
        </n-descriptions>
      </template>
      <template #footer>
        <n-space justify="end">
          <n-button @click="importReportVisible = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="backupImporting" @click="confirmImportSettings">
            {{ t('settings.backup.confirmImport') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message, confirm } from '@/utils/feedback'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { ensureMinimumDuration } from '@/composables/useMinimumLoading'
import type { SettingsImportReport } from '@/shared/settingsSync'

const { t } = useI18n()
const settingsStore = useSettingsStore()

// ── 重置设置 ──
async function resetSettings(): Promise<void> {
  confirm({
    title: t('generalSettings.resetConfirmTitle'),
    content: t('generalSettings.resetConfirmMsg'),
    positiveText: t('generalSettings.resetConfirmBtn'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await settingsStore.resetSettings()
        settingsStore.applyTheme()
        // 托盘与开机自启是主进程侧状态，重置后要同步回默认值
        if (window.electronAPI?.setTrayEnabled) {
          await window.electronAPI.setTrayEnabled(settingsStore.settings.minimizeToTray ?? true)
        }
        if (window.electronAPI?.setAutoLaunch) {
          await window.electronAPI.setAutoLaunch(settingsStore.settings.autoLaunch ?? false)
        }
        message.success(t('generalSettings.resetDone'))
      } catch (error) {
        console.error('[ResetBackupSettings] 重置设置失败:', error)
        message.error(
          t('generalSettings.resetFailed', {
            error: error instanceof Error ? error.message : t('settings.unknownError')
          })
        )
      }
    }
  })
}

// ── 配置备份 ──
const backupIncludeSecrets = ref(false)
const backupExporting = ref(false)
const backupImporting = ref(false)
const secretConfirmVisible = ref(false)
const importReportVisible = ref(false)
const importReport = ref<SettingsImportReport | null>(null)
const pendingImportData = ref<unknown>(null)
const backupFileInput = ref<HTMLInputElement | null>(null)

async function onExportSettings(): Promise<void> {
  // 含密钥的导出必须先过确认弹窗：明文密钥落到文件里，用户得知道
  if (backupIncludeSecrets.value) {
    secretConfirmVisible.value = true
    return
  }
  await doExportSettings()
}

async function doExportSettings(): Promise<void> {
  secretConfirmVisible.value = false
  const startedAt = Date.now()
  backupExporting.value = true
  try {
    const result = await window.electronAPI?.settingsExport?.({
      includeSecrets: backupIncludeSecrets.value
    })
    if (!result?.success || !result.data) {
      message.error(result?.error || t('settings.backup.exportFailed'))
      return
    }
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    link.href = url
    link.download = 'aria2desktop-settings-' + stamp + '.json'
    link.click()
    URL.revokeObjectURL(url)
    message.success(t('settings.backup.exportSuccess'))
  } catch (error) {
    console.error('[ResetBackupSettings] 导出配置失败:', error)
    message.error(t('settings.backup.exportFailed'))
  } finally {
    await ensureMinimumDuration(startedAt)
    backupExporting.value = false
  }
}

function triggerImportSettings(): void {
  backupFileInput.value?.click()
}

async function onImportFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 同一个文件连选两次也要触发 change，读完就把 value 清空
  input.value = ''
  if (!file) return

  const startedAt = Date.now()
  backupImporting.value = true
  try {
    const text = await file.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      message.error(t('settings.backup.parseFailed'))
      return
    }
    const preview = await window.electronAPI?.settingsImport?.(parsed, { dryRun: true })
    if (!preview?.success) {
      message.error(t('settings.backup.importFailed', { error: preview?.error || 'unknown' }))
      return
    }
    pendingImportData.value = parsed
    importReport.value = preview.report ?? null
    importReportVisible.value = true
  } catch (error) {
    console.error('[ResetBackupSettings] 读取导入文件失败:', error)
    message.error(t('settings.backup.parseFailed'))
  } finally {
    await ensureMinimumDuration(startedAt)
    backupImporting.value = false
  }
}

async function confirmImportSettings(): Promise<void> {
  if (pendingImportData.value === null) return
  const startedAt = Date.now()
  backupImporting.value = true
  try {
    const result = await window.electronAPI?.settingsImport?.(pendingImportData.value, { dryRun: false })
    if (!result?.success) {
      message.error(t('settings.backup.importFailed', { error: result?.error || 'unknown' }))
      return
    }
    importReportVisible.value = false
    pendingImportData.value = null
    message.success(t('settings.backup.importSuccess') + ' ' + t('settings.backup.restartHint'))
    // 主进程已落盘，渲染层重新拉一遍保证界面同步
    await settingsStore.initialize()
  } catch (error) {
    console.error('[ResetBackupSettings] 导入配置失败:', error)
    message.error(t('settings.backup.importFailed', { error: String(error) }))
  } finally {
    await ensureMinimumDuration(startedAt)
    backupImporting.value = false
  }
}
</script>

<style scoped>
.setting-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

/* 备份区：勾选框与操作按钮的间距 */
.backup-secrets-checkbox {
  margin-bottom: 12px;
}

.backup-actions {
  margin-top: 0;
}

.backup-file-input {
  display: none;
}

.import-report-value {
  font-variant-numeric: tabular-nums;
}
</style>
