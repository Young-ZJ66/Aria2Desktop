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
    <n-card :title="t('settings.advanced.groupEventMemory')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.eventPoll')" :tip="t('settings.advanced.eventPollTip')" />
          </template>
          <n-select
            v-model:value="form.eventPoll"
            :options="eventPollOptions"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.enableMmap')" :tip="t('settings.advanced.enableMmapTip')" />
          </template>
          <AppSwitch
            v-model:value="form.enableMmap"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.maxMmapLimit')" :tip="t('settings.advanced.maxMmapLimitTip')" />
          </template>
          <n-input-number
            v-model:value="form.maxMmapLimit"
            :min="0"
            :placeholder="t('settings.advanced.maxMmapLimitPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-form>
    </n-card>

    <n-card :title="t('settings.advanced.groupLog')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
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
            <TipLabel :label="t('settings.advanced.consoleLogLevel')" :tip="t('settings.advanced.consoleLogLevelTip')" />
          </template>
          <n-select
            v-model:value="form.consoleLogLevel"
            :options="logLevelOptions"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.summaryInterval')" :tip="t('settings.advanced.summaryIntervalTip')" />
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
            <TipLabel :label="t('settings.advanced.enableColor')" :tip="t('settings.advanced.enableColorTip')" />
          </template>
          <AppSwitch
            v-model:value="form.enableColor"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.humanReadable')" :tip="t('settings.advanced.humanReadableTip')" />
          </template>
          <AppSwitch
            v-model:value="form.humanReadable"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-form>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { parseSizeToUnit, formatSizeWithUnit } from '@/utils/size'
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'

const { t } = useI18n()
const connectionStore = useConnectionStore()

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
  eventPoll: 'epoll',
  enableMmap: false,
  maxMmapLimit: 0,
  log: '',
  logLevel: 'warn',
  consoleLogLevel: 'notice',
  summaryInterval: 60,
  enableColor: true,
  humanReadable: true
})

function applyOptionsToSettings(options: Aria2Option) {
  form.eventPoll = options['event-poll'] || 'epoll'
  form.enableMmap = options['enable-mmap'] === 'true'
  form.maxMmapLimit = parseSizeToUnit(options['max-mmap-limit'] || '0', 'G')
  form.log = options['log'] || ''
  form.logLevel = options['log-level'] || 'warn'
  form.consoleLogLevel = options['console-log-level'] || 'notice'
  form.summaryInterval = parseInt(options['summary-interval'] || '60')
  form.enableColor = options['enable-color'] !== 'false'
  form.humanReadable = options['human-readable'] !== 'false'
}

function toOptions(): Record<string, string> {
  const options: Record<string, string> = {
    'event-poll': form.eventPoll,
    'enable-mmap': form.enableMmap ? 'true' : 'false',
    'log-level': form.logLevel,
    'console-log-level': form.consoleLogLevel,
    'summary-interval': form.summaryInterval.toString(),
    'enable-color': form.enableColor ? 'true' : 'false',
    'human-readable': form.humanReadable ? 'true' : 'false'
  }

  if (form.log) options['log'] = form.log
  // 始终发送 max-mmap-limit（含 0=不限制），否则 aria2 会保留旧值导致"设 0 不生效"
  options['max-mmap-limit'] = formatSizeWithUnit(form.maxMmapLimit, 'G')
  return options
}

function defaults() {
  return {
    eventPoll: 'epoll',
    enableMmap: false,
    maxMmapLimit: 0,
    log: '',
    logLevel: 'warn',
    consoleLogLevel: 'notice',
    summaryInterval: 60,
    enableColor: true,
    humanReadable: true
  }
}

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(form, {
  applyOptions: applyOptionsToSettings,
  toOptions,
  defaults
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
