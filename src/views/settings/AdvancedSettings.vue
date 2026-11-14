<template>
  <SettingsPage
    :title="t('nav.advancedSettings')"
    :description="t('settings.advanced.description')"
    :show-connect-alert="true"
    :connected="connectionStore.isConnected"
    :show-actions="true"
    :saving="saving"
    :loading="loading"
    :disabled="!connectionStore.isConnected"
    @save="handleSave"
    @reload="loadSettings(true)"
    @reset="handleReset"
  >
    <n-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-placement="left"
      :label-width="180"
      label-align="left"
      :show-feedback="false"
    >
      <n-card :title="t('settings.advanced.groupEventMemory')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.eventPoll')" :tip="t('settings.advanced.eventPollTip')" :option="'event-poll'" />
          </template>
          <n-select
            v-model:value="form.eventPoll"
            :options="eventPollOptions"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.enableMmap')" :tip="t('settings.advanced.enableMmapTip')" :option="'enable-mmap'" />
          </template>
          <AppSwitch
            v-model:value="form.enableMmap"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="maxMmapLimit">
          <template #label>
            <TipLabel :label="t('settings.advanced.maxMmapLimit')" :tip="t('settings.advanced.maxMmapLimitTip')" :option="'max-mmap-limit'" />
          </template>
          <n-input-number
            v-model:value="form.maxMmapLimit"
            :min="0"
            :placeholder="t('settings.advanced.maxMmapLimitPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-card>

      <n-card :title="t('settings.advanced.groupLog')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.log')" :tip="t('settings.advanced.logTip')" />
          </template>
          <n-input-group>
            <n-input
              v-model:value="form.log"
              :placeholder="t('settings.advanced.logPlaceholder')"
              :disabled="!connectionStore.isConnected"
            />
            <n-button
              :disabled="!connectionStore.isConnected"
              @click="selectLogFile"
            >
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
            </n-button>
          </n-input-group>
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.logLevel')" :tip="t('settings.advanced.logLevelTip')" />
          </template>
          <n-select
            v-model:value="form.logLevel"
            :options="logLevelOptions"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.consoleLogLevel')" :tip="t('settings.advanced.consoleLogLevelTip')" :option="'console-log-level'" />
          </template>
          <n-select
            v-model:value="form.consoleLogLevel"
            :options="logLevelOptions"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="summaryInterval">
          <template #label>
            <TipLabel :label="t('settings.advanced.summaryInterval')" :tip="t('settings.advanced.summaryIntervalTip')" :option="'summary-interval'" />
          </template>
          <n-input-number
            v-model:value="form.summaryInterval"
            :min="0"
            :max="3600"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.enableColor')" :tip="t('settings.advanced.enableColorTip')" :option="'enable-color'" />
          </template>
          <AppSwitch
            v-model:value="form.enableColor"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.humanReadable')" :tip="t('settings.advanced.humanReadableTip')" :option="'human-readable'" />
          </template>
          <AppSwitch
            v-model:value="form.humanReadable"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <!-- 应用自身日志与上面这些 aria2 选项无关：报障时用户要附上的就是这里这个文件 -->
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.appLog')" :tip="t('settings.advanced.appLogTip')" />
          </template>
          <n-input-group>
            <n-input
              :value="logsDir"
              readonly
              :placeholder="t('settings.advanced.appLogLoading')"
            />
            <n-button @click="openLogsDir">
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
              {{ t('settings.advanced.openLogsDir') }}
            </n-button>
          </n-input-group>
        </n-form-item>
      </n-card>

      <!-- Headless Web 控制台：应用自身功能，不依赖 aria2 连接与上方表单的保存流程 -->
      <n-card :title="t('settings.webConsole.title')" class="setting-group">
        <DismissibleAlert storage-key="settings.webConsole" type="info" :show-icon="false" class="web-console-tip">
          {{ t('settings.webConsole.description') }}
        </DismissibleAlert>
        <n-form-item :label="t('settings.webConsole.enabled')">
          <AppSwitch v-model:value="webConsole.enabled" />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.port')">
          <n-input-number v-model:value="webConsole.port" :min="1024" :max="65535" />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.token')">
          <n-input
            v-model:value="webConsole.token"
            :placeholder="t('settings.webConsole.tokenPlaceholder')"
            show-password-on="click"
            type="password"
          />
          <div class="field-hint">{{ t('settings.webConsole.masterTokenHint') }}</div>
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.allowedIps')">
          <n-input
            v-model:value="webConsole.allowedIps"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :placeholder="t('settings.webConsole.allowedIpsPlaceholder')"
          />
        </n-form-item>
        <n-space>
          <n-button type="primary" :loading="webConsoleSaving" @click="saveWebConsole">
            {{ t('common.save') }}
          </n-button>
          <n-button :loading="webConsoleLoading" @click="refreshWebConsole">
            {{ t('settings.webConsole.refresh') }}
          </n-button>
        </n-space>
        <n-descriptions v-if="webConsoleStatus" :column="1" bordered size="small" class="web-console-status">
          <n-descriptions-item :label="t('settings.webConsole.status')">
            {{ webConsoleStatus.running ? t('settings.webConsole.running') : t('settings.webConsole.stopped') }}
          </n-descriptions-item>
          <n-descriptions-item v-if="webConsoleStatus.url" :label="t('settings.webConsole.url')">
            {{ webConsoleStatus.url }}
          </n-descriptions-item>
          <n-descriptions-item v-if="webConsoleStatus.token" :label="t('settings.webConsole.activeToken')">
            {{ webConsoleStatus.token }}
          </n-descriptions-item>
          <n-descriptions-item v-if="webConsoleStatus.error" :label="t('settings.webConsole.error')">
            {{ webConsoleStatus.error }}
          </n-descriptions-item>
        </n-descriptions>
        <n-table v-if="webConsoleStatus?.audit?.length" :single-line="false" size="small" class="web-console-audit">
          <thead>
            <tr>
              <th>{{ t('settings.webConsole.auditTime') }}</th>
              <th>{{ t('settings.webConsole.auditIp') }}</th>
              <th>{{ t('settings.webConsole.auditAction') }}</th>
              <th>{{ t('settings.webConsole.auditDetail') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in webConsoleStatus.audit.slice(0, 20)" :key="index">
              <td>{{ entry.time }}</td>
              <td>{{ entry.ip }}</td>
              <td>{{ entry.action }}</td>
              <td>{{ entry.detail }}</td>
            </tr>
          </tbody>
        </n-table>
      </n-card>

      <!-- 细粒度 API 令牌：主令牌仍兼容旧客户端，新客户端按需分配最小权限 -->
      <n-card :title="t('settings.webConsole.tokensTitle')" class="setting-group">
        <div class="token-header">
          <div class="token-desc">{{ t('settings.webConsole.tokensDesc') }}</div>
          <n-button size="small" type="primary" @click="openTokenModal()">
            {{ t('settings.webConsole.tokenAdd') }}
          </n-button>
        </div>

        <n-table v-if="webConsoleTokens.length" :single-line="false" size="small" class="web-console-audit">
          <thead>
            <tr>
              <th>{{ t('settings.webConsole.tokenName') }}</th>
              <th>{{ t('settings.webConsole.tokenScopes') }}</th>
              <th>{{ t('settings.webConsole.tokenLastUsed') }}</th>
              <th>{{ t('settings.webConsole.tokenCreatedAt') }}</th>
              <th class="token-action-col">{{ t('settings.webConsole.tokenDelete') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in webConsoleTokens" :key="token.id">
              <td>{{ token.name }}</td>
              <td>
                <n-space :size="4">
                  <n-tag
                    v-for="scope in token.scopes"
                    :key="scope"
                    size="small"
                    :type="scope === 'admin' ? 'warning' : 'default'"
                  >
                    {{ scopeLabel(scope) }}
                  </n-tag>
                </n-space>
              </td>
              <td>{{ token.lastUsedAt ? formatDateTime(token.lastUsedAt) : '—' }}</td>
              <td>{{ token.createdAt ? formatDateTime(token.createdAt) : '—' }}</td>
              <td>
                <n-space :size="4">
                  <n-button size="tiny" @click="openTokenModal(token)">
                    {{ t('settings.webConsole.tokenEdit') }}
                  </n-button>
                  <n-popconfirm @positive-click="deleteToken(token.id)">
                    <template #trigger>
                      <n-button size="tiny" type="error" quaternary>
                        {{ t('settings.webConsole.tokenDelete') }}
                      </n-button>
                    </template>
                    {{ t('settings.webConsole.tokenDeleteConfirm', { name: token.name }) }}
                  </n-popconfirm>
                </n-space>
              </td>
            </tr>
          </tbody>
        </n-table>
        <n-empty v-else :description="t('settings.webConsole.tokenEmpty')" size="small" class="token-empty" />
      </n-card>

      <!-- 配置备份：导出/导入走主进程白名单与脱敏逻辑，导入前先预览 -->
      <n-card :title="t('settings.backup.title')" class="setting-group">
        <DismissibleAlert storage-key="settings.backup" type="info" :show-icon="false" class="web-console-tip">
          {{ t('settings.backup.description') }}
        </DismissibleAlert>
        <n-form-item :label="t('settings.backup.includeSecrets')">
          <AppSwitch v-model:value="backupIncludeSecrets" />
        </n-form-item>
        <n-space>
          <n-button :loading="backupExporting" @click="onExportSettings">
            {{ t('settings.backup.export') }}
          </n-button>
          <n-button :loading="backupImporting" @click="triggerImportSettings">
            {{ t('settings.backup.chooseFile') }}
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
    </n-form>

    <!-- 新增/编辑令牌 -->
    <n-modal
      v-model:show="tokenModalVisible"
      preset="card"
      :title="tokenEditingId ? t('settings.webConsole.tokenEdit') : t('settings.webConsole.tokenAdd')"
      class="token-modal"
    >
      <n-form label-placement="top">
        <n-form-item :label="t('settings.webConsole.tokenName')">
          <n-input
            v-model:value="tokenForm.name"
            :maxlength="50"
            show-count
            :placeholder="t('settings.webConsole.tokenNamePlaceholder')"
          />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.tokenScopes')">
          <n-select
            v-model:value="tokenForm.scopes"
            multiple
            :options="scopeOptions"
            :placeholder="t('settings.webConsole.tokenScopesPlaceholder')"
          />
        </n-form-item>
        <n-form-item :label="t('settings.webConsole.tokenValue')">
          <n-input-group>
            <n-input v-model:value="tokenForm.token" readonly />
            <n-button v-if="!tokenEditingId" @click="regenerateToken">
              {{ t('settings.webConsole.tokenRegenerate') }}
            </n-button>
            <n-button @click="copyTokenValue">
              {{ t('common.copy') }}
            </n-button>
          </n-input-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="tokenModalVisible = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="tokenSaving" @click="saveToken">
            {{ t('common.save') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

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
    >
      <div v-if="importReport" class="import-report">
        <div class="import-report-row">
          <span class="import-report-label">{{ t('settings.backup.applied') }}</span>
          <n-space :size="4">
            <n-tag v-for="key in importReport.applied" :key="key" size="small" type="success">{{ key }}</n-tag>
            <span v-if="!importReport.applied.length">—</span>
          </n-space>
        </div>
        <div v-if="importReport.skipped.length" class="import-report-row">
          <span class="import-report-label">{{ t('settings.backup.skipped') }}</span>
          <n-space :size="4">
            <n-tag v-for="key in importReport.skipped" :key="key" size="small">{{ key }}</n-tag>
          </n-space>
        </div>
        <div v-if="importReport.rejected.length" class="import-report-row">
          <span class="import-report-label">{{ t('settings.backup.rejected') }}</span>
          <div class="import-report-rejected">
            <div v-for="item in importReport.rejected" :key="item.key">
              <n-tag size="small" type="error">{{ item.key }}</n-tag>
              <span class="import-report-reason">{{ item.reason }}</span>
            </div>
          </div>
        </div>
        <div v-if="importReport.preservedSecrets > 0" class="import-report-row">
          <span class="import-report-label">{{ t('settings.backup.includeSecrets') }}</span>
          <span>{{ t('settings.backup.preservedSecrets', { count: importReport.preservedSecrets }) }}</span>
        </div>
      </div>
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
import { computed, ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { FormRules, FormInst } from 'naive-ui'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { withMinimumDuration } from '@/composables/useMinimumLoading'
import type { SettingSchema } from '@/types/settingSchema'
import { useSettingSchema } from '@/composables/useSettingSchema'
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'
import type { WebConsoleScope, WebConsoleToken } from '@/shared/appSettings'
import type { SettingsImportReport } from '@/shared/settingsSync'

const { t } = useI18n()
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()
const formRef = ref<FormInst | null>(null)

// Headless Web 控制台（应用自身设置，独立于 aria2 表单）
interface WebConsoleAuditEntry {
  time: string
  ip: string
  action: string
  detail: string
  success: boolean
}

interface WebConsoleStatus {
  running: boolean
  port: number
  url: string
  token: string
  error?: string
  audit?: WebConsoleAuditEntry[]
}

const webConsole = reactive({
  enabled: false,
  port: 6802,
  token: '',
  allowedIps: ''
})
const webConsoleStatus = ref<WebConsoleStatus | null>(null)
const webConsoleLoading = ref(false)
const webConsoleSaving = ref(false)

// 细粒度令牌：与主令牌同存于 settings.webConsole.tokens
const webConsoleTokens = ref<WebConsoleToken[]>([])
const tokenModalVisible = ref(false)
const tokenEditingId = ref('')
const tokenSaving = ref(false)
const tokenForm = reactive({
  name: '',
  scopes: [] as WebConsoleScope[],
  token: ''
})

const SCOPE_VALUES: WebConsoleScope[] = ['tasks:read', 'tasks:write', 'tasks:control', 'audit:read', 'admin']
const scopeOptions = computed(() =>
  SCOPE_VALUES.map((value) => ({
    label: t('settings.webConsole.' + scopeKey(value)),
    value
  }))
)

function scopeKey(scope: WebConsoleScope): string {
  const map: Record<WebConsoleScope, string> = {
    'tasks:read': 'scopeTasksRead',
    'tasks:write': 'scopeTasksWrite',
    'tasks:control': 'scopeTasksControl',
    'audit:read': 'scopeAuditRead',
    admin: 'scopeAdmin'
  }
  return map[scope]
}

function scopeLabel(scope: WebConsoleScope): string {
  return t('settings.webConsole.' + scopeKey(scope))
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

/** 生成 18 字节随机数的 hex（36 位），满足主进程 >= 16 位的下限 */
function generateTokenValue(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function openTokenModal(token?: WebConsoleToken): void {
  tokenEditingId.value = token?.id ?? ''
  tokenForm.name = token?.name ?? ''
  tokenForm.scopes = token ? [...token.scopes] : ['tasks:read']
  // 编辑时令牌值不可改：客户端已经在用，换值等于让对端立即失效
  tokenForm.token = token?.token ?? generateTokenValue()
  tokenModalVisible.value = true
}

function regenerateToken(): void {
  tokenForm.token = generateTokenValue()
}

async function copyTokenValue(): Promise<void> {
  try {
    await navigator.clipboard.writeText(tokenForm.token)
    message.success(t('common.copied'))
  } catch (error) {
    console.error('[AdvancedSettings] 复制令牌失败:', error)
    message.error(t('settings.webConsole.tokenSaveFailed'))
  }
}

async function persistTokens(next: WebConsoleToken[]): Promise<boolean> {
  const current = settingsStore.settings.webConsole
  await settingsStore.updateSetting('webConsole', {
    enabled: current?.enabled === true,
    port: current?.port ?? 6802,
    token: current?.token ?? '',
    allowedIps: current?.allowedIps ?? [],
    tokens: next
  })
  webConsoleTokens.value = next
  return true
}

async function saveToken(): Promise<void> {
  const name = tokenForm.name.trim()
  if (!name) {
    message.error(t('settings.webConsole.tokenNameRequired'))
    return
  }
  if (name.length > 50) {
    message.error(t('settings.webConsole.tokenNameTooLong'))
    return
  }
  if (tokenForm.scopes.length === 0) {
    message.error(t('settings.webConsole.tokenScopesRequired'))
    return
  }
  if (tokenForm.token.length < 16) {
    message.error(t('settings.webConsole.tokenTooShort'))
    return
  }

  tokenSaving.value = true
  try {
    const now = new Date().toISOString()
    let next: WebConsoleToken[]
    if (tokenEditingId.value) {
      next = webConsoleTokens.value.map((item) =>
        item.id === tokenEditingId.value
          ? { ...item, name, scopes: [...tokenForm.scopes] }
          : item
      )
    } else {
      next = [
        ...webConsoleTokens.value,
        {
          id: generateTokenValue().slice(0, 16),
          name,
          token: tokenForm.token,
          scopes: [...tokenForm.scopes],
          createdAt: now
        }
      ]
    }
    await persistTokens(next)
    tokenModalVisible.value = false
    message.success(t('settings.webConsole.tokenSaved'))
    await refreshWebConsole()
  } catch (error) {
    console.error('[AdvancedSettings] 保存令牌失败:', error)
    message.error(t('settings.webConsole.tokenSaveFailed'))
  } finally {
    tokenSaving.value = false
  }
}

async function deleteToken(id: string): Promise<void> {
  try {
    await persistTokens(webConsoleTokens.value.filter((item) => item.id !== id))
    message.success(t('settings.webConsole.tokenDeleted'))
    await refreshWebConsole()
  } catch (error) {
    console.error('[AdvancedSettings] 删除令牌失败:', error)
    message.error(t('settings.webConsole.tokenDeleteFailed'))
  }
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
    console.error('[AdvancedSettings] 导出配置失败:', error)
    message.error(t('settings.backup.exportFailed'))
  } finally {
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
    console.error('[AdvancedSettings] 读取导入文件失败:', error)
    message.error(t('settings.backup.parseFailed'))
  } finally {
    backupImporting.value = false
  }
}

async function confirmImportSettings(): Promise<void> {
  if (pendingImportData.value === null) return
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
    syncWebConsoleFromSettings()
  } catch (error) {
    console.error('[AdvancedSettings] 导入配置失败:', error)
    message.error(t('settings.backup.importFailed', { error: String(error) }))
  } finally {
    backupImporting.value = false
  }
}

function syncWebConsoleFromSettings(): void {
  const current = settingsStore.settings.webConsole
  webConsole.enabled = current?.enabled === true
  webConsole.port = current?.port ?? 6802
  webConsole.token = current?.token ?? ''
  webConsole.allowedIps = (current?.allowedIps ?? []).join('\n')
  webConsoleTokens.value = (current?.tokens ?? []).map((token) => ({ ...token }))
}

async function refreshWebConsole(): Promise<void> {
  webConsoleLoading.value = true
  try {
    const status = await withMinimumDuration(async () => window.electronAPI?.webConsoleStatus?.())
    if (status) webConsoleStatus.value = status
  } catch (error) {
    console.error('[AdvancedSettings] 读取 Web 控制台状态失败:', error)
  } finally {
    webConsoleLoading.value = false
  }
}

async function saveWebConsole(): Promise<void> {
  webConsoleSaving.value = true
  try {
    const allowedIps = webConsole.allowedIps
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
    await settingsStore.updateSetting('webConsole', {
      enabled: webConsole.enabled,
      port: Math.min(65535, Math.max(1024, Number(webConsole.port) || 6802)),
      token: webConsole.token.trim(),
      allowedIps,
      // 整键替换语义：不带上 tokens 会把已配置的细粒度令牌抹掉
      tokens: webConsoleTokens.value
    })
    const result = await window.electronAPI?.webConsoleRestart?.()
    await refreshWebConsole()
    if (result?.error) {
      message.error(result.error)
    } else {
      message.success(t('settings.webConsole.saved'))
    }
  } catch (error) {
    console.error('[AdvancedSettings] 保存 Web 控制台设置失败:', error)
    message.error(t('settings.webConsole.saveFailed'))
  } finally {
    webConsoleSaving.value = false
  }
}

// 应用自身日志路径：由主进程从 electron-log 解析，渲染层只展示与打开
const logsDir = ref('')

async function loadLogsPath(): Promise<void> {
  try {
    const result = await window.electronAPI?.getLogsPath?.()
    logsDir.value = result?.dir || ''
  } catch {
    // 旧版 preload 没有这个方法时保持为空，不影响其它设置项
  }
}

async function openLogsDir(): Promise<void> {
  try {
    const result = await window.electronAPI?.openLogsDir?.()
    if (result?.success) {
      if (result.dir) logsDir.value = result.dir
      return
    }
    message.error(result?.error || t('settings.advanced.openLogsFailed'))
  } catch (error) {
    // 原样把 Error 丢给用户没有意义（String(error) 就是 "Error: ..."），
    // 具体原因留给控制台与应用日志
    console.error('[AdvancedSettings] 打开日志目录失败:', error)
    message.error(t('settings.advanced.openLogsFailed'))
  }
}

onMounted(() => {
  syncWebConsoleFromSettings()
  void loadLogsPath()
  void refreshWebConsole()
})

const eventPollOptions = [
  { label: 'epoll', value: 'epoll' },
  { label: 'kqueue', value: 'kqueue' },
  { label: 'port', value: 'port' },
  { label: 'poll', value: 'poll' },
  { label: 'select', value: 'select' }
]

const logLevelOptions = [
  { label: 'debug', value: 'debug' },
  { label: 'info', value: 'info' },
  { label: 'notice', value: 'notice' },
  { label: 'warn', value: 'warn' },
  { label: 'error', value: 'error' }
]

const form = reactive({
  eventPoll: 'select',
  enableMmap: false,
  maxMmapLimit: 0,
  log: '',
  logLevel: 'warn',
  consoleLogLevel: 'notice',
  summaryInterval: 60,
  enableColor: true,
  humanReadable: true
})

// 表单验证规则
const rules: FormRules = {
  // max-mmap-limit 单位 GB，0 表示不限制，仅校验非负
  maxMmapLimit: [
    { type: 'number', min: 0, message: () => t('settings.valueMin', { min: 0 }), trigger: 'blur' }
  ],
  // summary-interval 取值范围 0-3600 秒
  summaryInterval: [
    { type: 'number', min: 0, max: 3600, message: () => t('settings.valueRange', { min: 0, max: 3600 }), trigger: 'blur' }
  ]
}

// aria2 选项 <-> 表单字段 的 schema 声明：type 决定默认转换规则，
// max-mmap-limit 为 size 类型，size 类型保存时始终写入（含 0=不限制），
// 保证「设 0 不生效」问题不会回归
const advancedSettingsSchema: SettingSchema = {
  fields: [
    { key: 'eventPoll', aria2Key: 'event-poll', type: 'select', default: 'select' },
    { key: 'enableMmap', aria2Key: 'enable-mmap', type: 'boolean', default: false },
    { key: 'maxMmapLimit', aria2Key: 'max-mmap-limit', type: 'size', default: 0, unit: 'G' },
    { key: 'log', aria2Key: 'log', type: 'string', default: '' },
    { key: 'logLevel', aria2Key: 'log-level', type: 'select', default: 'warn' },
    { key: 'consoleLogLevel', aria2Key: 'console-log-level', type: 'select', default: 'notice' },
    { key: 'summaryInterval', aria2Key: 'summary-interval', type: 'number', default: 60 },
    { key: 'enableColor', aria2Key: 'enable-color', type: 'boolean', default: true },
    { key: 'humanReadable', aria2Key: 'human-readable', type: 'boolean', default: true }
  ]
}

const { applyOptions, toOptions, defaults } = useSettingSchema(advancedSettingsSchema, form)

// 表单校验：失败时阻止保存并提示第一条错误
async function validate(): Promise<boolean> {
  if (!formRef.value) return true
  try {
    await formRef.value.validate()
    return true
  } catch (errors) {
    const first = Array.isArray(errors) && errors.length > 0 ? errors[0] : undefined
    const msg = Array.isArray(first) && first.length > 0 && first[0]?.message
      ? first[0].message
      : t('settings.saveFailedShort')
    message.error(msg)
    return false
  }
}

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(form, {
  // 未保存离开确认：跟踪全部表单字段（原始值，JSON 序列化对比）
  dirtyTracking: {
    pageId: 'advanced',
    fields: Object.keys(form) as Array<keyof typeof form & string>
  },
  applyOptions,
  toOptions,
  defaults,
  validate
})

// 选择日志文件
async function selectLogFile() {
  if (!window.electronAPI) {
    message.warning(t('task.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openFile'],
      title: t('settings.advanced.logDialog')
    })

    if (!result.canceled && result.filePaths.length > 0) {
      // 长度已校验，`?? ''` 只是满足 noUncheckedIndexedAccess
      form.log = result.filePaths[0] ?? ''
    }
  } catch (_error) {
    message.error(t('settings.selectFileFailed'))
  }
}
</script>

<style scoped>
.setting-group {
  margin-bottom: 16px;
}

/* 远程 Web 控制台的保存/刷新按钮与下方运行状态之间留出呼吸空间 */
.web-console-tip {
  margin-bottom: 16px;
}

.web-console-status {
  margin-top: 16px;
}

.web-console-audit {
  margin-top: 12px;
}

.field-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-color-3);
  line-height: 1.5;
}

.token-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.token-desc {
  font-size: 13px;
  color: var(--text-color-3);
  line-height: 1.6;
}

.token-empty {
  padding: 8px 0;
}

.token-action-col {
  width: 140px;
}

.backup-file-input {
  display: none;
}

.token-modal {
  width: min(560px, 92vw);
}

.import-report-modal {
  width: min(640px, 92vw);
}

.import-report-row {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  align-items: flex-start;
  font-size: 13px;
}

.import-report-label {
  flex: 0 0 120px;
  color: var(--text-color-3);
}

.import-report-rejected {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.import-report-reason {
  margin-left: 8px;
  color: var(--text-color-3);
}
</style>
