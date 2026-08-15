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
      </n-form>
    </n-card>

    <n-card :title="t('settings.advanced.groupDownload')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.alwaysResume')" :tip="t('settings.advanced.alwaysResumeTip')" />
          </template>
          <AppSwitch
            v-model:value="form.alwaysResume"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.allowPieceLengthChange')" :tip="t('settings.advanced.allowPieceLengthChangeTip')" />
          </template>
          <AppSwitch
            v-model:value="form.allowPieceLengthChange"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.forceSequential')" :tip="t('settings.advanced.forceSequentialTip')" />
          </template>
          <AppSwitch
            v-model:value="form.forceSequential"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.parameterizedUri')" :tip="t('settings.advanced.parameterizedUriTip')" />
          </template>
          <AppSwitch
            v-model:value="form.parameterizedUri"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.pieceLength')" :tip="t('settings.advanced.pieceLengthTip')" />
          </template>
          <n-input-number
            v-model:value="form.pieceLength"
            :min="1"
            :max="1024"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.removeControlFile')" :tip="t('settings.advanced.removeControlFileTip')" />
          </template>
          <AppSwitch
            v-model:value="form.removeControlFile"
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

    <n-card :title="t('settings.advanced.groupSystem')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.asyncDns')" :tip="t('settings.advanced.asyncDnsTip')" />
          </template>
          <AppSwitch
            v-model:value="form.asyncDns"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.enableHttpPipelining')" :tip="t('settings.advanced.enableHttpPipeliningTip')" />
          </template>
          <AppSwitch
            v-model:value="form.enableHttpPipelining"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.advanced.checkIntegrity')" :tip="t('settings.advanced.checkIntegrityTip')" />
          </template>
          <AppSwitch
            v-model:value="form.checkIntegrity"
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
  log: '',
  logLevel: 'warn',
  consoleLogLevel: 'notice',
  summaryInterval: 60,
  enableColor: true,
  alwaysResume: true,
  allowPieceLengthChange: false,
  forceSequential: false,
  parameterizedUri: false,
  pieceLength: 1,
  removeControlFile: false,
  humanReadable: true,
  asyncDns: true,
  enableHttpPipelining: false,
  checkIntegrity: false
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
      form.log = options['log'] || ''
      form.logLevel = options['log-level'] || 'warn'
      form.consoleLogLevel = options['console-log-level'] || 'notice'
      form.summaryInterval = parseInt(options['summary-interval'] || '60')
      form.enableColor = options['enable-color'] !== 'false'
      form.alwaysResume = options['always-resume'] !== 'false'
      form.allowPieceLengthChange = options['allow-piece-length-change'] === 'true'
      form.forceSequential = options['force-sequential'] === 'true'
      form.parameterizedUri = options['parameterized-uri'] === 'true'
      // piece-length 可能是字节数（如 "1048576"）或带单位（如 "1M"），统一转为 MB
      const pieceLengthValue = options['piece-length'] || '1M'
      form.pieceLength = parseSizeToUnit(pieceLengthValue, 'M')
      form.removeControlFile = options['remove-control-file'] === 'true'
      form.humanReadable = options['human-readable'] !== 'false'
      form.asyncDns = options['async-dns'] !== 'false'
      form.enableHttpPipelining = options['enable-http-pipelining'] === 'true'
      form.checkIntegrity = options['check-integrity'] === 'true'
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
      'always-resume': form.alwaysResume ? 'true' : 'false',
      'allow-piece-length-change': form.allowPieceLengthChange ? 'true' : 'false',
      'force-sequential': form.forceSequential ? 'true' : 'false',
      'parameterized-uri': form.parameterizedUri ? 'true' : 'false',
      'piece-length': formatSizeWithUnit(form.pieceLength, 'M'),
      'remove-control-file': form.removeControlFile ? 'true' : 'false',
      'human-readable': form.humanReadable ? 'true' : 'false',
      'async-dns': form.asyncDns ? 'true' : 'false',
      'enable-http-pipelining': form.enableHttpPipelining ? 'true' : 'false',
      'check-integrity': form.checkIntegrity ? 'true' : 'false'
    }

    if (form.log) options['log'] = form.log

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
        log: '',
        logLevel: 'warn',
        consoleLogLevel: 'notice',
        summaryInterval: 60,
        enableColor: true,
        alwaysResume: true,
        allowPieceLengthChange: false,
        forceSequential: false,
        parameterizedUri: false,
        pieceLength: 1,
        removeControlFile: false,
        humanReadable: true,
        asyncDns: true,
        enableHttpPipelining: false,
        checkIntegrity: false
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
