<template>
  <SettingsPage
    :title="t('nav.advancedSettings')"
    :description="t('settings.advanced.description')"
    :show-connect-alert="true"
    :connected="connectionStore.isConnected"
    :show-actions="true"
    :saving="saving"
    :disabled="!connectionStore.isConnected"
    @save="handleSave"
    @reload="handleReload"
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
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { message, dialog } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { parseSizeToUnit, formatSizeWithUnit } from '@/utils/size'

const { t } = useI18n()
const connectionStore = useConnectionStore()
const statsStore = useStatsStore()

const saving = ref(false)

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

onMounted(() => {
  if (connectionStore.isConnected) {
    loadSettings()
  }
})

async function loadSettings() {
  if (!connectionStore.isConnected) {
    message.warning(t('settings.connectFirst'))
    return
  }

  try {
    const options = await statsStore.getGlobalOptions()

    if (options && typeof options === 'object') {
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
    message.error(t('settings.loadFailed', { error: errorMessage }))
    console.error('Failed to load advanced settings:', error)
  }
}

function handleReload() {
  loadSettings()
}

async function handleSave() {
  if (!connectionStore.isConnected) {
    message.warning(t('settings.connectFirst'))
    return
  }

  saving.value = true
  try {
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

    await statsStore.changeGlobalOptions(options)
    message.success(t('settings.saved'))
  } catch (error) {
    message.error(t('settings.saveFailedShort'))
    console.error('Failed to save advanced settings:', error)
  } finally {
    saving.value = false
  }
}

function handleReset() {
  dialog.warning({
    title: t('settings.restoreConfirmTitle'),
    content: t('settings.restoreConfirm'),
    positiveText: t('common.ok'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      Object.assign(form, {
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
      message.success(t('settings.restored'))
    }
  })
}

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
