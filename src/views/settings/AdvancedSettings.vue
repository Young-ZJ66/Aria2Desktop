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
    @reload="loadSettings"
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
      </n-card>
    </n-form>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { FormRules, FormInst } from 'naive-ui'
import { useConnectionStore } from '@/stores/connectionStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import type { SettingSchema } from '@/types/settingSchema'
import { useSettingSchema } from '@/composables/useSettingSchema'
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'

const { t } = useI18n()
const connectionStore = useConnectionStore()
const formRef = ref<FormInst | null>(null)

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
      form.log = result.filePaths[0]
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
