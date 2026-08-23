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
            :suffix="t('settings.download.kbPerSec')"
          />
        </n-form-item>

        <n-form-item path="maxOverallUploadLimit">
          <template #label>
            <TipLabel :label="t('settings.download.maxOverallUploadLimit')" :tip="t('settings.download.maxOverallUploadLimitTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxOverallUploadLimit"
            :min="0"
            :suffix="t('settings.download.kbPerSec')"
          />
        </n-form-item>

        <n-form-item path="maxDownloadLimit">
          <template #label>
            <TipLabel :label="t('settings.download.maxDownloadLimit')" :tip="t('settings.download.maxDownloadLimitTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxDownloadLimit"
            :min="0"
            :suffix="t('settings.download.kbPerSec')"
          />
        </n-form-item>

        <n-form-item path="maxUploadLimit">
          <template #label>
            <TipLabel :label="t('settings.download.maxUploadLimit')" :tip="t('settings.download.maxUploadLimitTip')" />
          </template>
          <n-input-number
            v-model:value="settings.maxUploadLimit"
            :min="0"
            :suffix="t('settings.download.kbPerSec')"
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
import { FolderOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { FormRules, FormInst } from 'naive-ui'

import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { parseSizeToUnit } from '@/utils/size'
import type { SettingSchema } from '@/types/settingSchema'
import { useSettingSchema } from '@/composables/useSettingSchema'
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

// download-result 选项标签本地化，跟随语言实时切换
const downloadResultOptions = computed(() => [
  { label: t('settings.download.downloadResultDefault'), value: 'default' },
  { label: t('settings.download.downloadResultFull'), value: 'full' },
  { label: t('settings.download.downloadResultHide'), value: 'hide' }
])

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

// aria2 选项 <-> 表单字段 的 schema 声明：type 决定默认转换规则。
// 特殊字段覆盖默认转换：
// - dir：保存时始终写入（含空串），避免清空下载目录后 aria2 保留旧目录
// - minSplitSize：表单值是 '1M'/'5M' 等字符串，加载时解析为 `${N}M` 并同步到下拉选项
// - continue：原转换语义为「只有显式 'true' 才启用」（未返回时视为关闭），保留自定义转换
const downloadSettingsSchema: SettingSchema = {
  fields: [
    {
      key: 'dir', aria2Key: 'dir', type: 'string', default: '',
      valueToOption: (value) => (value ? String(value) : '')
    },
    { key: 'maxConcurrentDownloads', aria2Key: 'max-concurrent-downloads', type: 'number', default: 5 },
    { key: 'maxConnectionPerServer', aria2Key: 'max-connection-per-server', type: 'number', default: 16 },
    { key: 'split', aria2Key: 'split', type: 'number', default: 16 },
    {
      key: 'minSplitSize', aria2Key: 'min-split-size', type: 'string', default: '10M',
      optionToValue: (raw) => {
        const value = `${parseSizeToUnit(raw ?? '10M', 'M')}M`
        if (!minSplitSizeOptions.some((o) => o.value === value)) {
          minSplitSizeOptions.push({ label: value, value })
        }
        return value
      }
    },
    { key: 'continue', aria2Key: 'continue', type: 'boolean', default: true, optionToValue: (raw) => raw === 'true' },
    { key: 'saveSession', aria2Key: 'save-session', type: 'boolean', default: true },
    { key: 'saveSessionInterval', aria2Key: 'save-session-interval', type: 'number', default: 60 },
    { key: 'maxOverallDownloadLimit', aria2Key: 'max-overall-download-limit', type: 'size', default: 0, unit: 'K' },
    { key: 'maxOverallUploadLimit', aria2Key: 'max-overall-upload-limit', type: 'size', default: 0, unit: 'K' },
    { key: 'maxDownloadLimit', aria2Key: 'max-download-limit', type: 'size', default: 0, unit: 'K' },
    { key: 'maxUploadLimit', aria2Key: 'max-upload-limit', type: 'size', default: 0, unit: 'K' },
    { key: 'diskCache', aria2Key: 'disk-cache', type: 'size', default: 16, unit: 'M' },
    { key: 'fileAllocation', aria2Key: 'file-allocation', type: 'select', default: 'prealloc' },
    { key: 'maxDownloadResult', aria2Key: 'max-download-result', type: 'number', default: 1000 },
    { key: 'realtimeChunkChecksum', aria2Key: 'realtime-chunk-checksum', type: 'boolean', default: true },
    { key: 'uriSelector', aria2Key: 'uri-selector', type: 'select', default: 'feedback' },
    { key: 'streamPieceSelector', aria2Key: 'stream-piece-selector', type: 'select', default: 'default' },
    { key: 'allowOverwrite', aria2Key: 'allow-overwrite', type: 'boolean', default: false },
    { key: 'autoFileRenaming', aria2Key: 'auto-file-renaming', type: 'boolean', default: true },
    { key: 'remoteTime', aria2Key: 'remote-time', type: 'boolean', default: false },
    { key: 'reuseUri', aria2Key: 'reuse-uri', type: 'boolean', default: true },
    { key: 'alwaysResume', aria2Key: 'always-resume', type: 'boolean', default: true },
    { key: 'maxResumeFailureTries', aria2Key: 'max-resume-failure-tries', type: 'number', default: 0 },
    { key: 'conditionalGet', aria2Key: 'conditional-get', type: 'boolean', default: false },
    { key: 'forceSequential', aria2Key: 'force-sequential', type: 'boolean', default: false },
    { key: 'parameterizedUri', aria2Key: 'parameterized-uri', type: 'boolean', default: false },
    { key: 'removeControlFile', aria2Key: 'remove-control-file', type: 'boolean', default: false },
    { key: 'checkIntegrity', aria2Key: 'check-integrity', type: 'boolean', default: false },
    { key: 'optimizeConcurrentDownloads', aria2Key: 'optimize-concurrent-downloads', type: 'boolean', default: false },
    { key: 'autoSaveInterval', aria2Key: 'auto-save-interval', type: 'number', default: 0 },
    { key: 'noFileAllocationLimit', aria2Key: 'no-file-allocation-limit', type: 'size', default: 0, unit: 'M' },
    { key: 'downloadResult', aria2Key: 'download-result', type: 'select', default: 'default' },
    { key: 'keepUnfinishedDownloadResult', aria2Key: 'keep-unfinished-download-result', type: 'boolean', default: true }
  ]
}

const { applyOptions, toOptions, defaults } = useSettingSchema(downloadSettingsSchema, settings)

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
  applyOptions,
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
