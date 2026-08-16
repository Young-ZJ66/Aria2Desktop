<template>
  <SettingsPage
    :title="t('nav.rpcSecuritySettings')"
    :description="t('settings.rpc.description')"
    :show-connect-alert="true"
    :connected="connectionStore.isConnected"
    :show-actions="true"
    :saving="saving"
    :disabled="!connectionStore.isConnected"
    @save="handleSave"
    @reload="handleReload"
    @reset="handleReset"
  >
    <n-spin :show="loading">
      <!-- RPC 服务 -->
      <n-card :title="t('settings.rpc.groupService')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.enableRpc')" :tip="t('settings.rpc.enableRpcTip')" />
            </template>
            <AppSwitch v-model:value="settings.enableRpc" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.rpcListenPort')" :tip="t('settings.rpc.rpcListenPortTip')" />
            </template>
            <n-input-number v-model:value="settings.rpcListenPort" :min="1024" :max="65535" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.rpcListenAll')" :tip="t('settings.rpc.rpcListenAllTip')" />
            </template>
            <AppSwitch v-model:value="settings.rpcListenAll" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.rpcMaxRequestSize')" :tip="t('settings.rpc.rpcMaxRequestSizeTip')" />
            </template>
            <n-input-number v-model:value="settings.rpcMaxRequestSize" :min="0" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.rpcSaveUploadMetadata')" :tip="t('settings.rpc.rpcSaveUploadMetadataTip')" />
            </template>
            <AppSwitch v-model:value="settings.rpcSaveUploadMetadata" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.pauseMetadata')" :tip="t('settings.rpc.pauseMetadataTip')" />
            </template>
            <AppSwitch v-model:value="settings.pauseMetadata" />
          </n-form-item>
        </n-form>
      </n-card>

      <!-- RPC 安全 -->
      <n-card :title="t('settings.rpc.groupSecurity')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.rpcSecret')" :tip="t('settings.rpc.rpcSecretTip')" />
            </template>
            <n-input
              v-model:value="settings.rpcSecret"
              type="password"
              show-password-on="click"
              clearable
              :placeholder="t('settings.rpc.rpcSecretPlaceholder')"
            />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.rpcAllowOriginAll')" :tip="t('settings.rpc.rpcAllowOriginAllTip')" />
            </template>
            <AppSwitch v-model:value="settings.rpcAllowOriginAll" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.forceSave')" :tip="t('settings.rpc.forceSaveTip')" />
            </template>
            <AppSwitch v-model:value="settings.forceSave" />
          </n-form-item>
        </n-form>
      </n-card>

      <!-- TLS 加密 -->
      <n-card :title="t('settings.rpc.groupTls')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.rpcCertificate')" :tip="t('settings.rpc.rpcCertificateTip')" />
            </template>
            <n-input-group>
              <n-input v-model:value="settings.rpcCertificate" :placeholder="t('settings.rpc.rpcCertificatePlaceholder')" clearable />
              <n-button @click="selectFile('rpcCertificate', t('settings.rpc.rpcCertificateDialog'))">
                <template #icon>
                  <n-icon><FolderOpenOutline /></n-icon>
                </template>
              </n-button>
            </n-input-group>
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.rpc.rpcPrivateKey')" :tip="t('settings.rpc.rpcPrivateKeyTip')" />
            </template>
            <n-input-group>
              <n-input v-model:value="settings.rpcPrivateKey" :placeholder="t('settings.rpc.rpcPrivateKeyPlaceholder')" clearable />
              <n-button @click="selectFile('rpcPrivateKey', t('settings.rpc.rpcPrivateKeyDialog'))">
                <template #icon>
                  <n-icon><FolderOpenOutline /></n-icon>
                </template>
              </n-button>
            </n-input-group>
          </n-form-item>
        </n-form>
      </n-card>
    </n-spin>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon } from 'naive-ui'
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

const loading = ref(false)
const saving = ref(false)

const settings = reactive({
  enableRpc: true,
  rpcListenPort: 6800,
  rpcListenAll: false,
  rpcSecret: '',
  rpcAllowOriginAll: false,
  rpcMaxRequestSize: '2M',
  rpcSaveUploadMetadata: true,
  rpcCertificate: '',
  rpcPrivateKey: '',
  forceSave: false,
  pauseMetadata: false
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

  loading.value = true
  try {
    const options = await statsStore.getGlobalOptions()
    if (options) {
      settings.enableRpc = options['enable-rpc'] !== 'false'
      settings.rpcListenPort = parseInt(options['rpc-listen-port'] || '6800')
      settings.rpcListenAll = options['rpc-listen-all'] === 'true'
      settings.rpcSecret = options['rpc-secret'] || ''
      settings.rpcAllowOriginAll = options['rpc-allow-origin-all'] === 'true'
      settings.rpcMaxRequestSize = parseSizeToUnit(options['rpc-max-request-size'] || '2M', 'M')
      settings.rpcSaveUploadMetadata = options['rpc-save-upload-metadata'] !== 'false'
      settings.rpcCertificate = options['rpc-certificate'] || ''
      settings.rpcPrivateKey = options['rpc-private-key'] || ''
      settings.forceSave = options['force-save'] === 'true'
      settings.pauseMetadata = options['pause-metadata'] === 'true'
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
    message.error(t('settings.loadFailed', { error: errorMessage }))
    console.error('Failed to load RPC/Security settings:', error)
  } finally {
    loading.value = false
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
      'enable-rpc': settings.enableRpc ? 'true' : 'false',
      'rpc-listen-port': settings.rpcListenPort.toString(),
      'rpc-listen-all': settings.rpcListenAll ? 'true' : 'false',
      'rpc-allow-origin-all': settings.rpcAllowOriginAll ? 'true' : 'false',
      'rpc-max-request-size': formatSizeWithUnit(settings.rpcMaxRequestSize, 'M'),
      'rpc-save-upload-metadata': settings.rpcSaveUploadMetadata ? 'true' : 'false',
      'force-save': settings.forceSave ? 'true' : 'false',
      'pause-metadata': settings.pauseMetadata ? 'true' : 'false'
    }

    if (settings.rpcSecret) options['rpc-secret'] = settings.rpcSecret
    if (settings.rpcCertificate) options['rpc-certificate'] = settings.rpcCertificate
    if (settings.rpcPrivateKey) options['rpc-private-key'] = settings.rpcPrivateKey

    await statsStore.changeGlobalOptions(options)
    message.success(t('settings.saved'))
  } catch (error) {
    message.error(t('settings.saveFailedShort'))
    console.error('Failed to save RPC/Security settings:', error)
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
      settings.enableRpc = true
      settings.rpcListenPort = 6800
      settings.rpcListenAll = false
      settings.rpcSecret = ''
      settings.rpcAllowOriginAll = false
      settings.rpcMaxRequestSize = 2
      settings.rpcSaveUploadMetadata = true
      settings.rpcCertificate = ''
      settings.rpcPrivateKey = ''
      settings.forceSave = false
      settings.pauseMetadata = false

      message.success(t('settings.restored'))
    }
  })
}

// 选择证书/私钥文件
async function selectFile(field: 'rpcCertificate' | 'rpcPrivateKey', title: string) {
  if (!window.electronAPI) {
    message.warning(t('task.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openFile'],
      title
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
