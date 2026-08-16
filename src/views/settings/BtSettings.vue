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
      <!-- DHT 与网络 -->
      <n-card :title="t('settings.bt.groupDht')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.enableDht')" :tip="t('settings.bt.enableDhtTip')" />
            </template>
            <AppSwitch v-model:value="settings.enableDht" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.enableDht6')" :tip="t('settings.bt.enableDht6Tip')" />
            </template>
            <AppSwitch v-model:value="settings.enableDht6" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.dhtListenPort')" :tip="t('settings.bt.dhtListenPortTip')" />
            </template>
            <n-input-number v-model:value="settings.dhtListenPort" :min="1024" :max="65535" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.dhtFilePath')" :tip="t('settings.bt.dhtFilePathTip')" />
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
              <TipLabel :label="t('settings.bt.btEnableLpd')" :tip="t('settings.bt.btEnableLpdTip')" />
            </template>
            <AppSwitch v-model:value="settings.btEnableLpd" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.btExternalIp')" :tip="t('settings.bt.btExternalIpTip')" />
            </template>
            <n-input v-model:value="settings.btExternalIp" :placeholder="t('settings.bt.btExternalIpPlaceholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.dhtEntryPoint')" :tip="t('settings.bt.dhtEntryPointTip')" />
            </template>
            <n-input v-model:value="settings.dhtEntryPoint" :placeholder="t('settings.bt.dhtEntryPointPlaceholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.dhtEntryPoint6')" :tip="t('settings.bt.dhtEntryPoint6Tip')" />
            </template>
            <n-input v-model:value="settings.dhtEntryPoint6" :placeholder="t('settings.bt.dhtEntryPoint6Placeholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.dhtFilePath6')" :tip="t('settings.bt.dhtFilePath6Tip')" />
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

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.dhtMessageTimeout')" :tip="t('settings.bt.dhtMessageTimeoutTip')" />
            </template>
            <n-input-number v-model:value="settings.dhtMessageTimeout" :min="1" :max="60" />
          </n-form-item>
        </n-form>
      </n-card>

      <!-- 连接与对等 -->
      <n-card :title="t('settings.bt.groupConnections')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.listenPort')" :tip="t('settings.bt.listenPortTip')" />
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
        </n-form>
      </n-card>

      <!-- Tracker -->
      <n-card :title="t('settings.bt.groupTracker')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
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
        </n-form>
      </n-card>

      <!-- 做种 -->
      <n-card :title="t('settings.bt.groupSeeding')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
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
        </n-form>
      </n-card>

      <!-- 元数据与文件 -->
      <n-card :title="t('settings.bt.groupMetadata')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
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
        </n-form>
      </n-card>

      <!-- 客户端标识 -->
      <n-card :title="t('settings.bt.groupClient')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.peerIdPrefix')" :tip="t('settings.bt.peerIdPrefixTip')" />
            </template>
            <n-input v-model:value="settings.peerIdPrefix" :placeholder="t('settings.bt.peerIdPrefixPlaceholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.bt.peerAgent')" :tip="t('settings.bt.peerAgentTip')" />
            </template>
            <n-input v-model:value="settings.peerAgent" :placeholder="t('settings.bt.peerAgentPlaceholder')" clearable />
          </n-form-item>
        </n-form>
      </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon } from 'naive-ui'
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

const cryptoLevelOptions = [
  { label: 'plain', value: 'plain' },
  { label: 'arc4', value: 'arc4' }
]

const followTorrentOptions = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
  { label: 'mem', value: 'mem' }
]

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

function applyOptionsToSettings(options: Aria2Option) {
  settings.enableDht = options['enable-dht'] !== 'false'
  settings.enableDht6 = options['enable-dht6'] !== 'false'
  settings.dhtListenPort = parseInt(options['dht-listen-port'] || '6881')
  settings.dhtFilePath = options['dht-file-path'] || ''
  settings.dhtEntryPoint = options['dht-entry-point'] || ''
  settings.dhtEntryPoint6 = options['dht-entry-point6'] || ''
  settings.dhtFilePath6 = options['dht-file-path6'] || ''
  settings.dhtMessageTimeout = parseInt(options['dht-message-timeout'] || '10')
  settings.btEnableLpd = options['bt-enable-lpd'] === 'true'
  settings.btExternalIp = options['bt-external-ip'] || ''
  settings.listenPort = parseInt(options['listen-port'] || '6881')
  settings.btMaxPeers = parseInt(options['bt-max-peers'] || '55')
  settings.btMaxOpenFiles = parseInt(options['bt-max-open-files'] || '100')
  settings.btRequestPeerSpeedLimit = parseInt(options['bt-request-peer-speed-limit'] || '0')
  settings.btForceEncryption = options['bt-force-encryption'] === 'true'
  settings.enablePeerExchange = options['enable-peer-exchange'] !== 'false'
  settings.btRequireCrypto = options['bt-require-crypto'] === 'true'
  settings.btMinCryptoLevel = options['bt-min-crypto-level'] || 'plain'
  settings.btTracker = options['bt-tracker'] || ''
  settings.btExcludeTracker = options['bt-exclude-tracker'] || ''
  settings.btTrackerConnectTimeout = parseInt(options['bt-tracker-connect-timeout'] || '60')
  settings.btTrackerInterval = parseInt(options['bt-tracker-interval'] || '0')
  settings.btTrackerTimeout = parseInt(options['bt-tracker-timeout'] || '60')
  settings.seedRatio = parseFloat(options['seed-ratio'] || '1.0')
  settings.seedTime = parseInt(options['seed-time'] || '0')
  settings.btStopTimeout = parseInt(options['bt-stop-timeout'] || '0')
  settings.btPrioritizePiece = options['bt-prioritize-piece'] === 'true'
  settings.btHashCheckSeed = options['bt-hash-check-seed'] !== 'false'
  settings.btDetachSeedOnly = options['bt-detach-seed-only'] === 'true'
  settings.maxPieceLength = parseSizeToUnit(options['max-piece-length'] || '0', 'M')
  settings.btSeedUnverified = options['bt-seed-unverified'] === 'true'
  settings.btSaveMetadata = options['bt-save-metadata'] === 'true'
  settings.btLoadSavedMetadata = options['bt-load-saved-metadata'] === 'true'
  settings.btMetadataOnly = options['bt-metadata-only'] === 'true'
  settings.btRemoveUnselectedFile = options['bt-remove-unselected-file'] === 'true'
  settings.followTorrent = options['follow-torrent'] || 'true'
  const pieceLengthVal = options['piece-length'] || '1M'
  settings.pieceLength = parseSizeToUnit(pieceLengthVal, 'M')
  settings.allowPieceLengthChange = options['allow-piece-length-change'] === 'true'
  settings.peerIdPrefix = options['peer-id-prefix'] || ''
  settings.peerAgent = options['peer-agent'] || ''
}

function toOptions(): Record<string, string> {
  const options: Record<string, string> = {
    'enable-dht': settings.enableDht ? 'true' : 'false',
    'enable-dht6': settings.enableDht6 ? 'true' : 'false',
    'dht-listen-port': settings.dhtListenPort.toString(),
    'dht-message-timeout': settings.dhtMessageTimeout.toString(),
    'bt-enable-lpd': settings.btEnableLpd ? 'true' : 'false',
    'listen-port': settings.listenPort.toString(),
    'bt-max-peers': settings.btMaxPeers.toString(),
    'bt-max-open-files': settings.btMaxOpenFiles.toString(),
    'bt-request-peer-speed-limit': settings.btRequestPeerSpeedLimit.toString(),
    'bt-force-encryption': settings.btForceEncryption ? 'true' : 'false',
    'enable-peer-exchange': settings.enablePeerExchange ? 'true' : 'false',
    'bt-require-crypto': settings.btRequireCrypto ? 'true' : 'false',
    'bt-min-crypto-level': settings.btMinCryptoLevel,
    'bt-tracker-connect-timeout': settings.btTrackerConnectTimeout.toString(),
    'bt-tracker-interval': settings.btTrackerInterval.toString(),
    'bt-tracker-timeout': settings.btTrackerTimeout.toString(),
    'seed-ratio': settings.seedRatio.toString(),
    'seed-time': settings.seedTime.toString(),
    'bt-stop-timeout': settings.btStopTimeout.toString(),
    'bt-prioritize-piece': settings.btPrioritizePiece ? 'true' : 'false',
    'bt-hash-check-seed': settings.btHashCheckSeed ? 'true' : 'false',
    'bt-detach-seed-only': settings.btDetachSeedOnly ? 'true' : 'false',
    'bt-seed-unverified': settings.btSeedUnverified ? 'true' : 'false',
    'bt-save-metadata': settings.btSaveMetadata ? 'true' : 'false',
    'bt-load-saved-metadata': settings.btLoadSavedMetadata ? 'true' : 'false',
    'bt-metadata-only': settings.btMetadataOnly ? 'true' : 'false',
    'bt-remove-unselected-file': settings.btRemoveUnselectedFile ? 'true' : 'false',
    'follow-torrent': settings.followTorrent,
    'piece-length': formatSizeWithUnit(settings.pieceLength, 'M'),
    'allow-piece-length-change': settings.allowPieceLengthChange ? 'true' : 'false'
  }

  if (settings.dhtFilePath) options['dht-file-path'] = settings.dhtFilePath
  if (settings.dhtEntryPoint) options['dht-entry-point'] = settings.dhtEntryPoint
  if (settings.dhtEntryPoint6) options['dht-entry-point6'] = settings.dhtEntryPoint6
  if (settings.dhtFilePath6) options['dht-file-path6'] = settings.dhtFilePath6
  if (settings.btExternalIp) options['bt-external-ip'] = settings.btExternalIp
  if (settings.btTracker) options['bt-tracker'] = settings.btTracker
  if (settings.btExcludeTracker) options['bt-exclude-tracker'] = settings.btExcludeTracker
  options['max-piece-length'] = formatSizeWithUnit(settings.maxPieceLength, 'M')
  if (settings.peerIdPrefix) options['peer-id-prefix'] = settings.peerIdPrefix
  if (settings.peerAgent) options['peer-agent'] = settings.peerAgent
  return options
}

function defaults() {
  return {
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
  }
}

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(settings, {
  applyOptions: applyOptionsToSettings,
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
