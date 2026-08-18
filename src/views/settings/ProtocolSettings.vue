<template>
  <SettingsPage
    :title="t('nav.protocolSettings')"
    :description="t('settings.protocol.description')"
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
    <n-card :title="t('settings.protocol.groupHttpAuth')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.httpUser')" :tip="t('settings.protocol.httpUserTip')" />
          </template>
          <n-input
            v-model:value="form.httpUser"
            :placeholder="t('settings.protocol.httpUserPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.httpPasswd')" :tip="t('settings.protocol.httpPasswdTip')" />
          </template>
          <n-input
            v-model:value="form.httpPasswd"
            type="password"
            show-password-on="click"
            :placeholder="t('settings.protocol.httpPasswdPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.httpAuthChallenge')" :tip="t('settings.protocol.httpAuthChallengeTip')" />
          </template>
          <AppSwitch
            v-model:value="form.httpAuthChallenge"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-form>
    </n-card>

    <n-card :title="t('settings.protocol.groupHttpBehavior')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.httpAcceptGzip')" :tip="t('settings.protocol.httpAcceptGzipTip')" />
          </template>
          <AppSwitch
            v-model:value="form.httpAcceptGzip"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.httpNoCache')" :tip="t('settings.protocol.httpNoCacheTip')" />
          </template>
          <AppSwitch
            v-model:value="form.httpNoCache"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.header')" :tip="t('settings.protocol.headerTip')" />
          </template>
          <n-input
            v-model:value="form.header"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 8 }"
            :placeholder="t('settings.protocol.headerPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.referer')" :tip="t('settings.protocol.refererTip')" />
          </template>
          <n-input
            v-model:value="form.referer"
            :placeholder="t('settings.protocol.refererPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.enableHttpKeepAlive')" :tip="t('settings.protocol.enableHttpKeepAliveTip')" />
          </template>
          <AppSwitch
            v-model:value="form.enableHttpKeepAlive"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.enableHttpPipelining')" :tip="t('settings.protocol.enableHttpPipeliningTip')" />
          </template>
          <AppSwitch
            v-model:value="form.enableHttpPipelining"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.contentDispositionDefaultUtf8')" :tip="t('settings.protocol.contentDispositionDefaultUtf8Tip')" />
          </template>
          <AppSwitch
            v-model:value="form.contentDispositionDefaultUtf8"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-form>
    </n-card>

    <n-card :title="t('settings.protocol.groupTls')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.checkCertificate')" :tip="t('settings.protocol.checkCertificateTip')" />
          </template>
          <AppSwitch
            v-model:value="form.checkCertificate"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.minTlsVersion')" :tip="t('settings.protocol.minTlsVersionTip')" />
          </template>
          <n-select
            v-model:value="form.minTlsVersion"
            :options="minTlsVersionOptions"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.caCertificate')" :tip="t('settings.protocol.caCertificateTip')" />
          </template>
          <n-input-group>
            <n-input
              v-model:value="form.caCertificate"
              :placeholder="t('settings.protocol.caCertificatePlaceholder')"
              :disabled="!connectionStore.isConnected"
            />
            <n-button
              :disabled="!connectionStore.isConnected"
              @click="selectFile('caCertificate', t('settings.protocol.caCertificateDialog'))"
            >
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
            </n-button>
          </n-input-group>
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.certificate')" :tip="t('settings.protocol.certificateTip')" />
          </template>
          <n-input-group>
            <n-input
              v-model:value="form.certificate"
              :placeholder="t('settings.protocol.certificatePlaceholder')"
              :disabled="!connectionStore.isConnected"
            />
            <n-button
              :disabled="!connectionStore.isConnected"
              @click="selectFile('certificate', t('settings.protocol.certificateDialog'))"
            >
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
            </n-button>
          </n-input-group>
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.privateKey')" :tip="t('settings.protocol.privateKeyTip')" />
          </template>
          <n-input-group>
            <n-input
              v-model:value="form.privateKey"
              :placeholder="t('settings.protocol.privateKeyPlaceholder')"
              :disabled="!connectionStore.isConnected"
            />
            <n-button
              :disabled="!connectionStore.isConnected"
              @click="selectFile('privateKey', t('settings.protocol.privateKeyDialog'))"
            >
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
            </n-button>
          </n-input-group>
        </n-form-item>
      </n-form>
    </n-card>

    <n-card :title="t('settings.protocol.groupFtp')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.ftpUser')" />
          </template>
          <n-input
            v-model:value="form.ftpUser"
            :placeholder="t('settings.protocol.ftpUserPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.ftpPasswd')" />
          </template>
          <n-input
            v-model:value="form.ftpPasswd"
            type="password"
            show-password-on="click"
            :placeholder="t('settings.protocol.ftpPasswdPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.ftpType')" :tip="t('settings.protocol.ftpTypeTip')" />
          </template>
          <n-select
            v-model:value="form.ftpType"
            :options="ftpTypeOptions"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.ftpPasv')" :tip="t('settings.protocol.ftpPasvTip')" />
          </template>
          <AppSwitch
            v-model:value="form.ftpPasv"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.protocol.ftpReuseConnection')" :tip="t('settings.protocol.ftpReuseConnectionTip')" />
          </template>
          <AppSwitch
            v-model:value="form.ftpReuseConnection"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-form>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import type { Aria2Option } from '@/types/aria2'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'

const { t } = useI18n()
const connectionStore = useConnectionStore()

const ftpTypeOptions = [
  { label: 'binary', value: 'binary' },
  { label: 'ascii', value: 'ascii' }
]

// 选项标签跟随语言实时切换，避免切换语言后下拉框文案不更新
const minTlsVersionOptions = computed(() => [
  { label: t('settings.protocol.tlsAuto'), value: '' },
  { label: 'TLSv1', value: 'TLSv1' },
  { label: 'TLSv1.1', value: 'TLSv1.1' },
  { label: 'TLSv1.2', value: 'TLSv1.2' },
  { label: 'TLSv1.3', value: 'TLSv1.3' }
])

const form = reactive({
  httpUser: '',
  httpPasswd: '',
  httpAuthChallenge: false,
  httpAcceptGzip: false,
  httpNoCache: false,
  header: '',
  referer: '',
  enableHttpKeepAlive: true,
  enableHttpPipelining: false,
  contentDispositionDefaultUtf8: false,
  checkCertificate: true,
  minTlsVersion: '',
  caCertificate: '',
  certificate: '',
  privateKey: '',
  ftpUser: '',
  ftpPasswd: '',
  ftpType: 'binary',
  ftpPasv: true,
  ftpReuseConnection: true
})

function applyOptionsToSettings(options: Aria2Option) {
  form.httpUser = options['http-user'] || ''
  form.httpPasswd = options['http-passwd'] || ''
  form.httpAuthChallenge = options['http-auth-challenge'] === 'true'
  form.httpAcceptGzip = options['http-accept-gzip'] === 'true'
  form.httpNoCache = options['http-no-cache'] === 'true'
  form.header = options['header'] || ''
  form.referer = options['referer'] || ''
  form.enableHttpKeepAlive = options['enable-http-keep-alive'] !== 'false'
  form.enableHttpPipelining = options['enable-http-pipelining'] === 'true'
  form.contentDispositionDefaultUtf8 = options['content-disposition-default-utf8'] === 'true'
  form.checkCertificate = options['check-certificate'] !== 'false'
  form.minTlsVersion = options['min-tls-version'] || ''
  form.caCertificate = options['ca-certificate'] || ''
  form.certificate = options['certificate'] || ''
  form.privateKey = options['private-key'] || ''
  form.ftpUser = options['ftp-user'] || ''
  form.ftpPasswd = options['ftp-passwd'] || ''
  form.ftpType = options['ftp-type'] || 'binary'
  form.ftpPasv = options['ftp-pasv'] !== 'false'
  form.ftpReuseConnection = options['ftp-reuse-connection'] !== 'false'
}

function toOptions(): Record<string, string> {
  const options: Record<string, string> = {
    'http-auth-challenge': form.httpAuthChallenge ? 'true' : 'false',
    'http-accept-gzip': form.httpAcceptGzip ? 'true' : 'false',
    'http-no-cache': form.httpNoCache ? 'true' : 'false',
    'enable-http-keep-alive': form.enableHttpKeepAlive ? 'true' : 'false',
    'enable-http-pipelining': form.enableHttpPipelining ? 'true' : 'false',
    'content-disposition-default-utf8': form.contentDispositionDefaultUtf8 ? 'true' : 'false',
    'check-certificate': form.checkCertificate ? 'true' : 'false',
    'ftp-type': form.ftpType,
    'ftp-pasv': form.ftpPasv ? 'true' : 'false',
    'ftp-reuse-connection': form.ftpReuseConnection ? 'true' : 'false'
  }

  if (form.httpUser) options['http-user'] = form.httpUser
  if (form.httpPasswd) options['http-passwd'] = form.httpPasswd
  if (form.header) options['header'] = form.header
  if (form.referer) options['referer'] = form.referer
  if (form.minTlsVersion) options['min-tls-version'] = form.minTlsVersion
  if (form.caCertificate) options['ca-certificate'] = form.caCertificate
  if (form.certificate) options['certificate'] = form.certificate
  if (form.privateKey) options['private-key'] = form.privateKey
  if (form.ftpUser) options['ftp-user'] = form.ftpUser
  if (form.ftpPasswd) options['ftp-passwd'] = form.ftpPasswd
  return options
}

function defaults() {
  return {
    httpUser: '',
    httpPasswd: '',
    httpAuthChallenge: false,
    httpAcceptGzip: false,
    httpNoCache: false,
    header: '',
    referer: '',
    enableHttpKeepAlive: true,
    enableHttpPipelining: false,
    contentDispositionDefaultUtf8: false,
    checkCertificate: true,
    minTlsVersion: '',
    caCertificate: '',
    certificate: '',
    privateKey: '',
    ftpUser: '',
    ftpPasswd: '',
    ftpType: 'binary',
    ftpPasv: true,
    ftpReuseConnection: true
  }
}

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(form, {
  applyOptions: applyOptionsToSettings,
  toOptions,
  defaults
})

// 选择证书文件
async function selectFile(field: 'caCertificate' | 'certificate' | 'privateKey', title: string) {
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
      form[field] = result.filePaths[0]
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
