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
        <n-alert type="info" :show-icon="false" class="web-console-tip">
          {{ t('settings.webConsole.description') }}
        </n-alert>
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
    </n-form>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { FormRules, FormInst } from 'naive-ui'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import type { SettingSchema } from '@/types/settingSchema'
import { useSettingSchema } from '@/composables/useSettingSchema'
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'

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

function syncWebConsoleFromSettings(): void {
  const current = settingsStore.settings.webConsole
  webConsole.enabled = current?.enabled === true
  webConsole.port = current?.port ?? 6802
  webConsole.token = current?.token ?? ''
  webConsole.allowedIps = (current?.allowedIps ?? []).join('\n')
}

async function refreshWebConsole(): Promise<void> {
  webConsoleLoading.value = true
  try {
    const status = await window.electronAPI?.webConsoleStatus?.()
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
      allowedIps
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
</style>
