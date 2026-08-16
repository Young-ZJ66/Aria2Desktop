<template>
  <SettingsPage
    :title="t('nav.downloadSettings')"
    :description="t('settings.download.description')"
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
        :model="settings"
        :rules="rules"
        label-placement="left"
        :label-width="180"
        label-align="left"
        :show-feedback="false"
        :disabled="!connectionStore.isConnected"
      >
        <!-- 目录与会话 -->
        <n-card :title="t('settings.download.dirAndSession')" class="setting-group">

        <n-form-item path="dir">
          <template #label>
            <TipLabel :label="t('settings.download.dir')" :tip="t('settings.download.dirTip')" />
          </template>
          <n-input
            v-model:value="settings.dir"
            :placeholder="t('settings.download.dirPlaceholder')"
          >
            <template #suffix>
              <n-button text :disabled="!isElectron" @click="selectDirectory">
                <template #icon>
                  <n-icon><FolderOutline /></n-icon>
                </template>
              </n-button>
            </template>
          </n-input>
        </n-form-item>

        <n-form-item path="saveSession">
          <template #label>
            <TipLabel :label="t('settings.download.saveSession')" :tip="t('settings.download.saveSessionTip')" />
          </template>
          <AppSwitch v-model:value="settings.saveSession" />
        </n-form-item>

        <n-form-item path="saveSessionInterval">
          <template #label>
            <TipLabel :label="t('settings.download.saveSessionInterval')" :tip="t('settings.download.saveSessionIntervalTip')" />
          </template>
          <n-input-number
            v-model:value="settings.saveSessionInterval"
            :min="60"
            :max="3600"
            :disabled="!settings.saveSession"
          />
        </n-form-item>

        </n-card>

        <!-- 并发与分片 -->
        <n-card :title="t('settings.download.concurrency')" class="setting-group">

        <n-form-item path="maxConcurrentDownloads">
          <template #label>
            <TipLabel :label="t('settings.download.maxConcurrentDownloads')" :tip="t('settings.download.maxConcurrentDownloadsTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxConcurrentDownloads"
            :min="1"
            :max="16"
          />
        </n-form-item>

        <n-form-item path="maxConnectionPerServer">
          <template #label>
            <TipLabel :label="t('settings.download.maxConnectionPerServer')" :tip="t('settings.download.maxConnectionPerServerTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxConnectionPerServer"
            :min="1"
            :max="16"
          />
        </n-form-item>

        <n-form-item path="split">
          <template #label>
            <TipLabel :label="t('settings.download.split')" :tip="t('settings.download.splitTip')" />
          </template>
          <n-input-number
            v-model:value="settings.split"
            :min="1"
            :max="64"
          />
        </n-form-item>

        <n-form-item path="minSplitSize">
          <template #label>
            <TipLabel :label="t('settings.download.minSplitSize')" :tip="t('settings.download.minSplitSizeTip')" />
          </template>
          <n-select
            v-model:value="settings.minSplitSize"
            :options="minSplitSizeOptions"
          />
        </n-form-item>

        </n-card>

        <!-- 速度限制 -->
        <n-card :title="t('settings.download.speedLimit')" class="setting-group">

        <n-form-item path="maxOverallDownloadLimit">
          <template #label>
            <TipLabel :label="t('settings.download.maxOverallDownloadLimit')" :tip="t('settings.download.maxOverallDownloadLimitTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxOverallDownloadLimit"
            :min="0"
          />
        </n-form-item>

        <n-form-item path="maxOverallUploadLimit">
          <template #label>
            <TipLabel :label="t('settings.download.maxOverallUploadLimit')" :tip="t('settings.download.maxOverallUploadLimitTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxOverallUploadLimit"
            :min="0"
          />
        </n-form-item>

        <n-form-item path="maxDownloadLimit">
          <template #label>
            <TipLabel :label="t('settings.download.maxDownloadLimit')" :tip="t('settings.download.maxDownloadLimitTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxDownloadLimit"
            :min="0"
          />
        </n-form-item>

        <n-form-item path="maxUploadLimit">
          <template #label>
            <TipLabel :label="t('settings.download.maxUploadLimit')" :tip="t('settings.download.maxUploadLimitTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxUploadLimit"
            :min="0"
          />
        </n-form-item>

        </n-card>

        <!-- 磁盘与存储 -->
        <n-card :title="t('settings.download.diskAndMemory')" class="setting-group">

        <n-form-item path="diskCache">
          <template #label>
            <TipLabel :label="t('settings.download.diskCache')" :tip="t('settings.download.diskCacheTip')" />
          </template>
          <n-input-number
            v-model:value="settings.diskCache"
            :min="0"
            :max="1024"
          />
        </n-form-item>

        <n-form-item path="fileAllocation">
          <template #label>
            <TipLabel :label="t('settings.download.fileAllocation')" :tip="t('settings.download.fileAllocationTip')" />
          </template>
          <n-select
            v-model:value="settings.fileAllocation"
            :options="fileAllocationOptions"
          />
        </n-form-item>

        <n-form-item path="maxDownloadResult">
          <template #label>
            <TipLabel :label="t('settings.download.maxDownloadResult')" :tip="t('settings.download.maxDownloadResultTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxDownloadResult"
            :min="0"
            :max="10000"
          />
        </n-form-item>

        </n-card>

        <!-- 下载行为 -->
        <n-card :title="t('settings.download.behavior')" class="setting-group">

        <n-form-item path="continue">
          <template #label>
            <TipLabel :label="t('settings.download.continue')" :tip="t('settings.download.continueTip')" />
          </template>
          <AppSwitch v-model:value="settings.continue" />
        </n-form-item>

        <n-form-item path="realtimeChunkChecksum">
          <template #label>
            <TipLabel :label="t('settings.download.realtimeChunkChecksum')" :tip="t('settings.download.realtimeChunkChecksumTip')" />
          </template>
          <AppSwitch v-model:value="settings.realtimeChunkChecksum" />
        </n-form-item>

        <n-form-item path="uriSelector">
          <template #label>
            <TipLabel :label="t('settings.download.uriSelector')" :tip="t('settings.download.uriSelectorTip')" />
          </template>
          <n-select
            v-model:value="settings.uriSelector"
            :options="uriSelectorOptions"
          />
        </n-form-item>

        <n-form-item path="streamPieceSelector">
          <template #label>
            <TipLabel :label="t('settings.download.streamPieceSelector')" :tip="t('settings.download.streamPieceSelectorTip')" />
          </template>
          <n-select
            v-model:value="settings.streamPieceSelector"
            :options="streamPieceSelectorOptions"
          />
        </n-form-item>

        <n-form-item path="allowOverwrite">
          <template #label>
            <TipLabel :label="t('settings.download.allowOverwrite')" :tip="t('settings.download.allowOverwriteTip')" />
          </template>
          <AppSwitch v-model:value="settings.allowOverwrite" />
        </n-form-item>

        <n-form-item path="autoFileRenaming">
          <template #label>
            <TipLabel :label="t('settings.download.autoFileRenaming')" :tip="t('settings.download.autoFileRenamingTip')" />
          </template>
          <AppSwitch v-model:value="settings.autoFileRenaming" />
        </n-form-item>

        <n-form-item path="remoteTime">
          <template #label>
            <TipLabel :label="t('settings.download.remoteTime')" :tip="t('settings.download.remoteTimeTip')" />
          </template>
          <AppSwitch v-model:value="settings.remoteTime" />
        </n-form-item>

        <n-form-item path="reuseUri">
          <template #label>
            <TipLabel :label="t('settings.download.reuseUri')" :tip="t('settings.download.reuseUriTip')" />
          </template>
          <AppSwitch v-model:value="settings.reuseUri" />
        </n-form-item>

        <n-form-item path="alwaysResume">
          <template #label>
            <TipLabel :label="t('settings.download.alwaysResume')" :tip="t('settings.download.alwaysResumeTip')" />
          </template>
          <AppSwitch v-model:value="settings.alwaysResume" />
        </n-form-item>

        <n-form-item path="maxResumeFailureTries">
          <template #label>
            <TipLabel :label="t('settings.download.maxResumeFailureTries')" :tip="t('settings.download.maxResumeFailureTriesTip')" />
          </template>
          <n-input-number v-model:value="settings.maxResumeFailureTries" :min="0" :max="1000" />
        </n-form-item>

        <n-form-item path="conditionalGet">
          <template #label>
            <TipLabel :label="t('settings.download.conditionalGet')" :tip="t('settings.download.conditionalGetTip')" />
          </template>
          <AppSwitch v-model:value="settings.conditionalGet" />
        </n-form-item>

        <n-form-item path="forceSequential">
          <template #label>
            <TipLabel :label="t('settings.download.forceSequential')" :tip="t('settings.download.forceSequentialTip')" />
          </template>
          <AppSwitch v-model:value="settings.forceSequential" />
        </n-form-item>

        <n-form-item path="parameterizedUri">
          <template #label>
            <TipLabel :label="t('settings.download.parameterizedUri')" :tip="t('settings.download.parameterizedUriTip')" />
          </template>
          <AppSwitch v-model:value="settings.parameterizedUri" />
        </n-form-item>

        <n-form-item path="removeControlFile">
          <template #label>
            <TipLabel :label="t('settings.download.removeControlFile')" :tip="t('settings.download.removeControlFileTip')" />
          </template>
          <AppSwitch v-model:value="settings.removeControlFile" />
        </n-form-item>

        <n-form-item path="checkIntegrity">
          <template #label>
            <TipLabel :label="t('settings.download.checkIntegrity')" :tip="t('settings.download.checkIntegrityTip')" />
          </template>
          <AppSwitch v-model:value="settings.checkIntegrity" />
        </n-form-item>

        <n-form-item path="optimizeConcurrentDownloads">
          <template #label>
            <TipLabel :label="t('settings.download.optimizeConcurrentDownloads')" :tip="t('settings.download.optimizeConcurrentDownloadsTip')" />
          </template>
          <AppSwitch v-model:value="settings.optimizeConcurrentDownloads" />
        </n-form-item>

        <n-form-item path="autoSaveInterval">
          <template #label>
            <TipLabel :label="t('settings.download.autoSaveInterval')" :tip="t('settings.download.autoSaveIntervalTip')" />
          </template>
          <n-input-number v-model:value="settings.autoSaveInterval" :min="0" :max="3600" />
        </n-form-item>

        <n-form-item path="noFileAllocationLimit">
          <template #label>
            <TipLabel :label="t('settings.download.noFileAllocationLimit')" :tip="t('settings.download.noFileAllocationLimitTip')" />
          </template>
          <n-input-number v-model:value="settings.noFileAllocationLimit" :min="0" :placeholder="t('settings.download.noFileAllocationLimitPlaceholder')" />
        </n-form-item>

        <n-form-item path="downloadResult">
          <template #label>
            <TipLabel :label="t('settings.download.downloadResult')" :tip="t('settings.download.downloadResultTip')" />
          </template>
          <n-select v-model:value="settings.downloadResult" :options="downloadResultOptions" />
        </n-form-item>

        <n-form-item path="keepUnfinishedDownloadResult">
          <template #label>
            <TipLabel :label="t('settings.download.keepUnfinishedDownloadResult')" :tip="t('settings.download.keepUnfinishedDownloadResultTip')" />
          </template>
          <AppSwitch v-model:value="settings.keepUnfinishedDownloadResult" />
        </n-form-item>
        </n-card>
      </n-form>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon } from 'naive-ui'
import { FolderOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { FormRules, FormInst } from 'naive-ui'

import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { parseSizeToUnit, formatSizeWithUnit } from '@/utils/size'
import { useConnectionStore } from '@/stores/connectionStore'
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'

const connectionStore = useConnectionStore()
const { t } = useI18n()
const formRef = ref<FormInst | null>(null)

const isElectron = computed(() => !!window.electronAPI)

// 表单数据
const settings = reactive({
  dir: '',
  maxConcurrentDownloads: 5,
  maxConnectionPerServer: 5,
  split: 5,
  minSplitSize: '20M',
  continue: true,
  saveSession: true,
  saveSessionInterval: 60,
  maxOverallDownloadLimit: 0,
  maxOverallUploadLimit: 0,
  maxDownloadLimit: 0,
  maxUploadLimit: 0,
  diskCache: 16,
  fileAllocation: 'prealloc',
  maxDownloadResult: 1000,
  realtimeChunkChecksum: true,
  uriSelector: 'feedback',
  streamPieceSelector: 'default',
  allowOverwrite: false,
  autoFileRenaming: true,
  remoteTime: false,
  reuseUri: true,
  alwaysResume: true,
  maxResumeFailureTries: 0,
  conditionalGet: false,
  forceSequential: false,
  parameterizedUri: false,
  removeControlFile: false,
  checkIntegrity: false,
  optimizeConcurrentDownloads: false,
  autoSaveInterval: 0,
  noFileAllocationLimit: 0,
  downloadResult: 'default',
  keepUnfinishedDownloadResult: true
})

// 选项
const minSplitSizeOptions = [
  { label: '1M', value: '1M' },
  { label: '5M', value: '5M' },
  { label: '10M', value: '10M' },
  { label: '20M', value: '20M' },
  { label: '50M', value: '50M' },
  { label: '100M', value: '100M' }
]

// 选项标签跟随语言实时切换，避免切换语言后下拉框文案不更新
const fileAllocationOptions = computed(() => [
  { label: t('settings.download.fileAllocNone'), value: 'none' },
  { label: t('settings.download.fileAllocPrealloc'), value: 'prealloc' },
  { label: t('settings.download.fileAllocFalloc'), value: 'falloc' }
])

const uriSelectorOptions = computed(() => [
  { label: t('settings.download.uriFeedback'), value: 'feedback' },
  { label: t('settings.download.uriInorder'), value: 'inorder' },
  { label: t('settings.download.uriAdaptive'), value: 'adaptive' }
])

const streamPieceSelectorOptions = computed(() => [
  { label: t('settings.download.pieceDefault'), value: 'default' },
  { label: t('settings.download.pieceInorder'), value: 'inorder' },
  { label: t('settings.download.pieceRandom'), value: 'random' },
  { label: t('settings.download.pieceGeom'), value: 'geom' }
])

const downloadResultOptions = [
  { label: 'default', value: 'default' },
  { label: 'full', value: 'full' },
  { label: 'hide', value: 'hide' }
]

// 表单验证规则
const rules: FormRules = {
  maxConcurrentDownloads: [
    { type: 'number', min: 1, max: 16, message: () => t('settings.valueRange', { min: 1, max: 16 }), trigger: 'blur' }
  ],
  maxConnectionPerServer: [
    { type: 'number', min: 1, max: 16, message: () => t('settings.valueRange', { min: 1, max: 16 }), trigger: 'blur' }
  ],
  saveSessionInterval: [
    { type: 'number', min: 60, max: 3600, message: () => t('settings.valueRange', { min: 60, max: 3600 }), trigger: 'blur' }
  ],
  diskCache: [
    { type: 'number', min: 0, max: 1024, message: () => t('settings.valueRange', { min: 0, max: 1024 }), trigger: 'blur' }
  ],
  maxDownloadResult: [
    { type: 'number', min: 0, max: 10000, message: () => t('settings.valueRange', { min: 0, max: 10000 }), trigger: 'blur' }
  ]
}

function applyOptionsToSettings(options: Aria2Option) {
  settings.dir = options.dir || ''
  settings.maxConcurrentDownloads = parseInt(options['max-concurrent-downloads'] || '5')
  settings.maxConnectionPerServer = parseInt(options['max-connection-per-server'] || '16')
  settings.split = parseInt(options.split || '16')
  const minSplitValue = `${parseSizeToUnit(options['min-split-size'] || '10M', 'M')}M`
  settings.minSplitSize = minSplitValue
  if (!minSplitSizeOptions.some((o) => o.value === minSplitValue)) {
    minSplitSizeOptions.push({ label: minSplitValue, value: minSplitValue })
  }
  settings.continue = options.continue === 'true'
  settings.saveSession = options['save-session'] !== 'false'
  settings.saveSessionInterval = parseInt(options['save-session-interval'] || '60')
  settings.maxOverallDownloadLimit = parseSizeToUnit(options['max-overall-download-limit'] || '0', 'K')
  settings.maxOverallUploadLimit = parseSizeToUnit(options['max-overall-upload-limit'] || '0', 'K')
  settings.maxDownloadLimit = parseSizeToUnit(options['max-download-limit'] || '0', 'K')
  settings.maxUploadLimit = parseSizeToUnit(options['max-upload-limit'] || '0', 'K')
  settings.diskCache = parseSizeToUnit(options['disk-cache'] || '16M', 'M')
  settings.fileAllocation = options['file-allocation'] || 'prealloc'
  settings.maxDownloadResult = parseInt(options['max-download-result'] || '1000')
  settings.realtimeChunkChecksum = options['realtime-chunk-checksum'] !== 'false'
  settings.uriSelector = options['uri-selector'] || 'feedback'
  settings.streamPieceSelector = options['stream-piece-selector'] || 'default'
  settings.allowOverwrite = options['allow-overwrite'] === 'true'
  settings.autoFileRenaming = options['auto-file-renaming'] !== 'false'
  settings.remoteTime = options['remote-time'] === 'true'
  settings.reuseUri = options['reuse-uri'] !== 'false'
  settings.alwaysResume = options['always-resume'] !== 'false'
  settings.maxResumeFailureTries = parseInt(options['max-resume-failure-tries'] || '0')
  settings.conditionalGet = options['conditional-get'] === 'true'
  settings.forceSequential = options['force-sequential'] === 'true'
  settings.parameterizedUri = options['parameterized-uri'] === 'true'
  settings.removeControlFile = options['remove-control-file'] === 'true'
  settings.checkIntegrity = options['check-integrity'] === 'true'
  settings.optimizeConcurrentDownloads = options['optimize-concurrent-downloads'] === 'true'
  settings.autoSaveInterval = parseInt(options['auto-save-interval'] || '0')
  settings.noFileAllocationLimit = parseSizeToUnit(options['no-file-allocation-limit'] || '0', 'M')
  settings.downloadResult = options['download-result'] || 'default'
  settings.keepUnfinishedDownloadResult = options['keep-unfinished-download-result'] !== 'false'
}

function toOptions(): Record<string, string> {
  const options: Record<string, string> = {
    'dir': settings.dir,
    'max-concurrent-downloads': settings.maxConcurrentDownloads.toString(),
    'max-connection-per-server': settings.maxConnectionPerServer.toString(),
    'split': settings.split.toString(),
    'min-split-size': settings.minSplitSize,
    'continue': settings.continue.toString(),
    'save-session': settings.saveSession.toString(),
    'save-session-interval': settings.saveSessionInterval.toString(),
    'max-overall-download-limit': formatSizeWithUnit(settings.maxOverallDownloadLimit, 'K'),
    'max-overall-upload-limit': formatSizeWithUnit(settings.maxOverallUploadLimit, 'K'),
    'max-download-limit': formatSizeWithUnit(settings.maxDownloadLimit, 'K'),
    'max-upload-limit': formatSizeWithUnit(settings.maxUploadLimit, 'K'),
    'disk-cache': formatSizeWithUnit(settings.diskCache, 'M'),
    'file-allocation': settings.fileAllocation,
    'max-download-result': settings.maxDownloadResult.toString(),
    'realtime-chunk-checksum': settings.realtimeChunkChecksum ? 'true' : 'false',
    'uri-selector': settings.uriSelector,
    'stream-piece-selector': settings.streamPieceSelector,
    'allow-overwrite': settings.allowOverwrite ? 'true' : 'false',
    'auto-file-renaming': settings.autoFileRenaming ? 'true' : 'false',
    'remote-time': settings.remoteTime ? 'true' : 'false',
    'reuse-uri': settings.reuseUri ? 'true' : 'false',
    'always-resume': settings.alwaysResume ? 'true' : 'false',
    'max-resume-failure-tries': settings.maxResumeFailureTries.toString(),
    'conditional-get': settings.conditionalGet ? 'true' : 'false',
    'force-sequential': settings.forceSequential ? 'true' : 'false',
    'parameterized-uri': settings.parameterizedUri ? 'true' : 'false',
    'remove-control-file': settings.removeControlFile ? 'true' : 'false',
    'check-integrity': settings.checkIntegrity ? 'true' : 'false',
    'optimize-concurrent-downloads': settings.optimizeConcurrentDownloads ? 'true' : 'false',
    'auto-save-interval': settings.autoSaveInterval.toString(),
    'download-result': settings.downloadResult,
    'keep-unfinished-download-result': settings.keepUnfinishedDownloadResult ? 'true' : 'false'
  }
  options['no-file-allocation-limit'] = formatSizeWithUnit(settings.noFileAllocationLimit, 'M')
  return options
}

function defaults() {
  return {
    dir: '',
    maxConcurrentDownloads: 5,
    maxConnectionPerServer: 16,
    split: 16,
    minSplitSize: '10M',
    continue: true,
    saveSession: true,
    saveSessionInterval: 60,
    maxOverallDownloadLimit: 0,
    maxOverallUploadLimit: 0,
    maxDownloadLimit: 0,
    maxUploadLimit: 0,
    diskCache: 16,
    fileAllocation: 'prealloc',
    maxDownloadResult: 1000,
    realtimeChunkChecksum: true,
    uriSelector: 'feedback',
    streamPieceSelector: 'default',
    allowOverwrite: false,
    autoFileRenaming: true,
    remoteTime: false,
    reuseUri: true,
    alwaysResume: true,
    maxResumeFailureTries: 0,
    conditionalGet: false,
    forceSequential: false,
    parameterizedUri: false,
    removeControlFile: false,
    checkIntegrity: false,
    optimizeConcurrentDownloads: false,
    autoSaveInterval: 0,
    noFileAllocationLimit: 0,
    downloadResult: 'default',
    keepUnfinishedDownloadResult: true
  }
}

async function validate(): Promise<boolean> {
  if (!formRef.value) return true
  try {
    await formRef.value.validate()
    return true
  } catch (errors) {
    const msg = Array.isArray(errors) && errors[0]?.message ? errors[0].message : t('settings.saveFailedShort')
    message.error(msg)
    return false
  }
}

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(settings, {
  applyOptions: applyOptionsToSettings,
  toOptions,
  defaults,
  validate,
  loadErrorKey: 'settings.download.loadFailed',
  // 恢复默认后把下载目录填充为应用默认下载目录，避免输入框为空
  onAfterReset: async (form) => {
    if (!window.electronAPI?.getDefaultDownloadDir) return
    try {
      const result = await window.electronAPI.getDefaultDownloadDir()
      if (result?.success && result.path) {
        form.dir = result.path
      }
    } catch (error) {
      console.warn('Failed to get default download dir:', error)
    }
  }
})

async function selectDirectory() {
  if (!window.electronAPI) {
    message.warning(t('task.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openDirectory'],
      title: t('settings.download.selectDirTitle')
    })

    if (!result.canceled && result.filePaths.length > 0) {
      settings.dir = result.filePaths[0]
    }
  } catch (_error) {
    message.error(t('settings.download.selectDirFailed'))
  }
}
</script>

<style scoped>
.setting-group {
  margin-bottom: 16px;
}
</style>
