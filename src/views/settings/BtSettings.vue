<template>
  <SettingsPage
    :title="t('nav.btSettings')"
    :description="t('settings.bt.description')"
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
    >
      <!-- DHT 与网络 -->
      <n-card :title="t('settings.bt.groupDht')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.enableDht')" :tip="t('settings.bt.enableDhtTip')" :option="'enable-dht'" />
          </template>
          <AppSwitch v-model:value="settings.enableDht" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.enableDht6')" :tip="t('settings.bt.enableDht6Tip')" :option="'enable-dht6'" />
          </template>
          <AppSwitch v-model:value="settings.enableDht6" />
        </n-form-item>

        <n-form-item path="dhtListenPort">
          <template #label>
            <TipLabel :label="t('settings.bt.dhtListenPort')" :tip="t('settings.bt.dhtListenPortTip')" :option="'dht-listen-port'" />
          </template>
          <n-input-number v-model:value="settings.dhtListenPort" :min="1024" :max="65535" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.dhtFilePath')" :tip="t('settings.bt.dhtFilePathTip')" :option="'dht-file-path'" />
          </template>
          <n-input-group>
            <n-input v-model:value="settings.dhtFilePath" :placeholder="t('settings.bt.dhtFilePathPlaceholder')" clearable />
            <n-button @click="selectDhtFile('dhtFilePath')">
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
            </n-button>
          </n-input-group>
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btEnableLpd')" :tip="t('settings.bt.btEnableLpdTip')" :option="'bt-enable-lpd'" />
          </template>
          <AppSwitch v-model:value="settings.btEnableLpd" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btExternalIp')" :tip="t('settings.bt.btExternalIpTip')" :option="'bt-external-ip'" />
          </template>
          <n-input v-model:value="settings.btExternalIp" :placeholder="t('settings.bt.btExternalIpPlaceholder')" clearable />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.dhtEntryPoint')" :tip="t('settings.bt.dhtEntryPointTip')" :option="'dht-entry-point'" />
          </template>
          <n-input v-model:value="settings.dhtEntryPoint" :placeholder="t('settings.bt.dhtEntryPointPlaceholder')" clearable />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.dhtEntryPoint6')" :tip="t('settings.bt.dhtEntryPoint6Tip')" :option="'dht-entry-point6'" />
          </template>
          <n-input v-model:value="settings.dhtEntryPoint6" :placeholder="t('settings.bt.dhtEntryPoint6Placeholder')" clearable />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.dhtFilePath6')" :tip="t('settings.bt.dhtFilePath6Tip')" :option="'dht-file-path6'" />
          </template>
          <n-input-group>
            <n-input v-model:value="settings.dhtFilePath6" :placeholder="t('settings.bt.dhtFilePath6Placeholder')" clearable />
            <n-button @click="selectDhtFile('dhtFilePath6')">
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
            </n-button>
          </n-input-group>
        </n-form-item>

        <n-form-item path="dhtMessageTimeout">
          <template #label>
            <TipLabel :label="t('settings.bt.dhtMessageTimeout')" :tip="t('settings.bt.dhtMessageTimeoutTip')" />
          </template>
          <n-input-number v-model:value="settings.dhtMessageTimeout" :min="1" :max="60" />
        </n-form-item>
      </n-card>

      <!-- 连接与对等 -->
      <n-card :title="t('settings.bt.groupConnections')" class="setting-group">
        <n-form-item path="listenPort">
          <template #label>
            <TipLabel :label="t('settings.bt.listenPort')" :tip="t('settings.bt.listenPortTip')" :option="'listen-port'" />
          </template>
          <n-input-number v-model:value="settings.listenPort" :min="1024" :max="65535" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btMaxPeers')" :tip="t('settings.bt.btMaxPeersTip')" />
          </template>
          <n-input-number v-model:value="settings.btMaxPeers" :min="1" :max="1000" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btMaxOpenFiles')" :tip="t('settings.bt.btMaxOpenFilesTip')" />
          </template>
          <n-input-number v-model:value="settings.btMaxOpenFiles" :min="0" :max="10000" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btForceEncryption')" :tip="t('settings.bt.btForceEncryptionTip')" />
          </template>
          <AppSwitch v-model:value="settings.btForceEncryption" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btRequestPeerSpeedLimit')" :tip="t('settings.bt.btRequestPeerSpeedLimitTip')" />
          </template>
          <n-input-number v-model:value="settings.btRequestPeerSpeedLimit" :min="0" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.enablePeerExchange')" :tip="t('settings.bt.enablePeerExchangeTip')" />
          </template>
          <AppSwitch v-model:value="settings.enablePeerExchange" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btRequireCrypto')" :tip="t('settings.bt.btRequireCryptoTip')" />
          </template>
          <AppSwitch v-model:value="settings.btRequireCrypto" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btMinCryptoLevel')" :tip="t('settings.bt.btMinCryptoLevelTip')" />
          </template>
          <n-select v-model:value="settings.btMinCryptoLevel" :options="cryptoLevelOptions" />
        </n-form-item>
      </n-card>

      <!-- Tracker -->
      <n-card :title="t('settings.bt.groupTracker')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btTracker')" :tip="t('settings.bt.btTrackerTip')" />
          </template>
          <n-input
            v-model:value="settings.btTracker"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 8 }"
            :placeholder="t('settings.bt.btTrackerPlaceholder')"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btExcludeTracker')" :tip="t('settings.bt.btExcludeTrackerTip')" />
          </template>
          <n-input
            v-model:value="settings.btExcludeTracker"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 8 }"
            :placeholder="t('settings.bt.btExcludeTrackerPlaceholder')"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btTrackerConnectTimeout')" :tip="t('settings.bt.btTrackerConnectTimeoutTip')" />
          </template>
          <n-input-number v-model:value="settings.btTrackerConnectTimeout" :min="1" :max="600" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btTrackerInterval')" :tip="t('settings.bt.btTrackerIntervalTip')" />
          </template>
          <n-input-number v-model:value="settings.btTrackerInterval" :min="0" :max="86400" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btTrackerTimeout')" :tip="t('settings.bt.btTrackerTimeoutTip')" />
          </template>
          <n-input-number v-model:value="settings.btTrackerTimeout" :min="1" :max="600" />
        </n-form-item>
      </n-card>

      <!-- 做种 -->
      <n-card :title="t('settings.bt.groupSeeding')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.seedRatio')" :tip="t('settings.bt.seedRatioTip')" />
          </template>
          <n-input-number v-model:value="settings.seedRatio" :min="0" :max="100" :step="0.1" :precision="1" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.seedTime')" :tip="t('settings.bt.seedTimeTip')" />
          </template>
          <n-input-number v-model:value="settings.seedTime" :min="0" :max="999999" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btStopTimeout')" :tip="t('settings.bt.btStopTimeoutTip')" />
          </template>
          <n-input-number v-model:value="settings.btStopTimeout" :min="0" :max="86400" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btPrioritizePiece')" :tip="t('settings.bt.btPrioritizePieceTip')" />
          </template>
          <AppSwitch v-model:value="settings.btPrioritizePiece" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btHashCheckSeed')" :tip="t('settings.bt.btHashCheckSeedTip')" />
          </template>
          <AppSwitch v-model:value="settings.btHashCheckSeed" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btDetachSeedOnly')" :tip="t('settings.bt.btDetachSeedOnlyTip')" />
          </template>
          <AppSwitch v-model:value="settings.btDetachSeedOnly" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.maxPieceLength')" :tip="t('settings.bt.maxPieceLengthTip')" />
          </template>
          <n-input-number v-model:value="settings.maxPieceLength" :min="0" :placeholder="t('settings.bt.maxPieceLengthPlaceholder')" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btSeedUnverified')" :tip="t('settings.bt.btSeedUnverifiedTip')" />
          </template>
          <AppSwitch v-model:value="settings.btSeedUnverified" />
        </n-form-item>
      </n-card>

      <!-- 元数据与文件 -->
      <n-card :title="t('settings.bt.groupMetadata')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.followTorrent')" :tip="t('settings.bt.followTorrentTip')" />
          </template>
          <n-select v-model:value="settings.followTorrent" :options="followTorrentOptions" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btSaveMetadata')" :tip="t('settings.bt.btSaveMetadataTip')" />
          </template>
          <AppSwitch v-model:value="settings.btSaveMetadata" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btLoadSavedMetadata')" :tip="t('settings.bt.btLoadSavedMetadataTip')" />
          </template>
          <AppSwitch v-model:value="settings.btLoadSavedMetadata" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btMetadataOnly')" :tip="t('settings.bt.btMetadataOnlyTip')" />
          </template>
          <AppSwitch v-model:value="settings.btMetadataOnly" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.btRemoveUnselectedFile')" :tip="t('settings.bt.btRemoveUnselectedFileTip')" />
          </template>
          <AppSwitch v-model:value="settings.btRemoveUnselectedFile" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.pieceLength')" :tip="t('settings.bt.pieceLengthTip')" />
          </template>
          <n-input-number v-model:value="settings.pieceLength" :min="1" :max="1024" />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.allowPieceLengthChange')" :tip="t('settings.bt.allowPieceLengthChangeTip')" />
          </template>
          <AppSwitch v-model:value="settings.allowPieceLengthChange" />
        </n-form-item>
      </n-card>

      <!-- 客户端标识 -->
      <n-card :title="t('settings.bt.groupClient')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.peerIdPrefix')" :tip="t('settings.bt.peerIdPrefixTip')" :option="'peer-id-prefix'" />
          </template>
          <n-input v-model:value="settings.peerIdPrefix" :placeholder="t('settings.bt.peerIdPrefixPlaceholder')" clearable />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.bt.peerAgent')" :tip="t('settings.bt.peerAgentTip')" :option="'peer-agent'" />
          </template>
          <n-input v-model:value="settings.peerAgent" :placeholder="t('settings.bt.peerAgentPlaceholder')" clearable />
        </n-form-item>
      </n-card>
    </n-form>
  </SettingsPage>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { formatSizeWithUnit } from '@/utils/size'
import type { SettingSchema } from '@/types/settingSchema'
import { useSettingSchema } from '@/composables/useSettingSchema'
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'

const { t } = useI18n()
const connectionStore = useConnectionStore()

const cryptoLevelOptions = [
  { label: 'plain', value: 'plain' },
  { label: 'arc4', value: 'arc4' }
]

// follow-torrent 选项标签本地化，跟随语言实时切换
const followTorrentOptions = computed(() => [
  { label: t('settings.bt.followTorrentTrue'), value: 'true' },
  { label: t('settings.bt.followTorrentFalse'), value: 'false' },
  { label: t('settings.bt.followTorrentMem'), value: 'mem' }
])

const settings = reactive({
  enableDht: true,
  enableDht6: true,
  dhtListenPort: 6881,
  dhtFilePath: '',
  dhtEntryPoint: '',
  dhtEntryPoint6: '',
  dhtFilePath6: '',
  dhtMessageTimeout: 10,
  btEnableLpd: false,
  btExternalIp: '',
  listenPort: 6881,
  btMaxPeers: 55,
  btMaxOpenFiles: 100,
  btRequestPeerSpeedLimit: 0,
  btForceEncryption: false,
  enablePeerExchange: true,
  btRequireCrypto: false,
  btMinCryptoLevel: 'plain',
  btTracker: '',
  btExcludeTracker: '',
  btTrackerConnectTimeout: 60,
  btTrackerInterval: 0,
  btTrackerTimeout: 60,
  seedRatio: 1.0,
  seedTime: 0,
  btStopTimeout: 0,
  btPrioritizePiece: false,
  btHashCheckSeed: true,
  btDetachSeedOnly: false,
  maxPieceLength: 0,
  btSeedUnverified: false,
  btSaveMetadata: false,
  btLoadSavedMetadata: false,
  btMetadataOnly: false,
  btRemoveUnselectedFile: false,
  followTorrent: 'true',
  pieceLength: 1,
  allowPieceLengthChange: false,
  peerIdPrefix: '',
  peerAgent: ''
})

// aria2 选项 <-> 表单字段 的 schema 声明：type 决定默认转换规则。
// 特殊字段覆盖默认转换：
// - btPrioritizePiece：开启时写入固定的 head/tail 格式（head=32M,tail=32M），关闭时不写入
// - pieceLength：0 表示未设置（用 aria2 默认），>0 才写入，避免把 0 值写进配置文件
// - maxPieceLength：当前 aria2c 不识别该选项（启动报 Unknown option），一律不写入配置文件
const btSettingsSchema: SettingSchema = {
  fields: [
    { key: 'enableDht', aria2Key: 'enable-dht', type: 'boolean', default: true },
    { key: 'enableDht6', aria2Key: 'enable-dht6', type: 'boolean', default: true },
    { key: 'dhtListenPort', aria2Key: 'dht-listen-port', type: 'number', default: 6881 },
    { key: 'dhtFilePath', aria2Key: 'dht-file-path', type: 'string', default: '' },
    { key: 'dhtEntryPoint', aria2Key: 'dht-entry-point', type: 'string', default: '' },
    { key: 'dhtEntryPoint6', aria2Key: 'dht-entry-point6', type: 'string', default: '' },
    { key: 'dhtFilePath6', aria2Key: 'dht-file-path6', type: 'string', default: '' },
    { key: 'dhtMessageTimeout', aria2Key: 'dht-message-timeout', type: 'number', default: 10 },
    { key: 'btEnableLpd', aria2Key: 'bt-enable-lpd', type: 'boolean', default: false },
    { key: 'btExternalIp', aria2Key: 'bt-external-ip', type: 'string', default: '' },
    { key: 'listenPort', aria2Key: 'listen-port', type: 'number', default: 6881 },
    { key: 'btMaxPeers', aria2Key: 'bt-max-peers', type: 'number', default: 55 },
    { key: 'btMaxOpenFiles', aria2Key: 'bt-max-open-files', type: 'number', default: 100 },
    { key: 'btRequestPeerSpeedLimit', aria2Key: 'bt-request-peer-speed-limit', type: 'number', default: 0 },
    { key: 'btForceEncryption', aria2Key: 'bt-force-encryption', type: 'boolean', default: false },
    { key: 'enablePeerExchange', aria2Key: 'enable-peer-exchange', type: 'boolean', default: true },
    { key: 'btRequireCrypto', aria2Key: 'bt-require-crypto', type: 'boolean', default: false },
    { key: 'btMinCryptoLevel', aria2Key: 'bt-min-crypto-level', type: 'select', default: 'plain' },
    { key: 'btTracker', aria2Key: 'bt-tracker', type: 'string', default: '' },
    { key: 'btExcludeTracker', aria2Key: 'bt-exclude-tracker', type: 'string', default: '' },
    { key: 'btTrackerConnectTimeout', aria2Key: 'bt-tracker-connect-timeout', type: 'number', default: 60 },
    { key: 'btTrackerInterval', aria2Key: 'bt-tracker-interval', type: 'number', default: 0 },
    { key: 'btTrackerTimeout', aria2Key: 'bt-tracker-timeout', type: 'number', default: 60 },
    { key: 'seedRatio', aria2Key: 'seed-ratio', type: 'number', default: 1.0 },
    { key: 'seedTime', aria2Key: 'seed-time', type: 'number', default: 0 },
    { key: 'btStopTimeout', aria2Key: 'bt-stop-timeout', type: 'number', default: 0 },
    {
      key: 'btPrioritizePiece', aria2Key: 'bt-prioritize-piece', type: 'boolean', default: false,
      optionToValue: (raw) => !!raw,
      valueToOption: (value) => (value ? 'head=32M,tail=32M' : undefined)
    },
    { key: 'btHashCheckSeed', aria2Key: 'bt-hash-check-seed', type: 'boolean', default: true },
    { key: 'btDetachSeedOnly', aria2Key: 'bt-detach-seed-only', type: 'boolean', default: false },
    {
      key: 'maxPieceLength', aria2Key: 'max-piece-length', type: 'size', default: 0, unit: 'M',
      valueToOption: () => undefined
    },
    { key: 'btSeedUnverified', aria2Key: 'bt-seed-unverified', type: 'boolean', default: false },
    { key: 'btSaveMetadata', aria2Key: 'bt-save-metadata', type: 'boolean', default: false },
    { key: 'btLoadSavedMetadata', aria2Key: 'bt-load-saved-metadata', type: 'boolean', default: false },
    { key: 'btMetadataOnly', aria2Key: 'bt-metadata-only', type: 'boolean', default: false },
    { key: 'btRemoveUnselectedFile', aria2Key: 'bt-remove-unselected-file', type: 'boolean', default: false },
    { key: 'followTorrent', aria2Key: 'follow-torrent', type: 'select', default: 'true' },
    {
      key: 'pieceLength', aria2Key: 'piece-length', type: 'size', default: 1, unit: 'M',
      valueToOption: (value) => (Number(value) > 0 ? formatSizeWithUnit(Number(value), 'M') : undefined)
    },
    { key: 'allowPieceLengthChange', aria2Key: 'allow-piece-length-change', type: 'boolean', default: false },
    { key: 'peerIdPrefix', aria2Key: 'peer-id-prefix', type: 'string', default: '' },
    { key: 'peerAgent', aria2Key: 'peer-agent', type: 'string', default: '' }
  ]
}

const { applyOptions, toOptions, defaults } = useSettingSchema(btSettingsSchema, settings)

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(settings, {
  applyOptions,
  toOptions,
  defaults
})

// 选择 DHT 路由表文件
async function selectDhtFile(field: 'dhtFilePath' | 'dhtFilePath6') {
  if (!window.electronAPI) {
    message.warning(t('task.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openFile'],
      title: field === 'dhtFilePath'
        ? t('settings.bt.dhtFilePathDialog')
        : t('settings.bt.dhtFilePath6Dialog')
    })

    if (!result.canceled && result.filePaths.length > 0) {
      settings[field] = result.filePaths[0]
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
