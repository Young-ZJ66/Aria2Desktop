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
    <n-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-placement="left"
      :label-width="180"
      label-align="left"
      :show-feedback="false"
    >
      <n-card :title="t('settings.protocol.groupHttpAuth')" class="setting-group">
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
      </n-card>

      <n-card :title="t('settings.protocol.groupHttpBehavior')" class="setting-group">
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

        <n-form-item path="referer">
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
      </n-card>

      <n-card :title="t('settings.protocol.groupTls')" class="setting-group">
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
      </n-card>

      <n-card :title="t('settings.protocol.groupFtp')" class="setting-group">
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
      </n-card>
    </n-form>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
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

// referer 校验：为空时跳过（让 aria2 保留旧值），非空时需为带 http(s) 协议头的合法 URL
function isValidReferer(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim())
}

// 表单验证规则
const rules: FormRules = {
  referer: [
    { validator: (_rule, value) => (typeof value === 'string' && value.trim() && !isValidReferer(value) ? new Error(t('settings.invalidUrl')) : true), trigger: 'blur' }
  ]
}

// aria2 选项 <-> 表单字段 的 schema 声明：type 决定默认转换规则，本页全部走默认转换
const protocolSettingsSchema: SettingSchema = {
  fields: [
    { key: 'httpUser', aria2Key: 'http-user', type: 'string', default: '' },
    { key: 'httpPasswd', aria2Key: 'http-passwd', type: 'string', default: '' },
    { key: 'httpAuthChallenge', aria2Key: 'http-auth-challenge', type: 'boolean', default: false },
    { key: 'httpAcceptGzip', aria2Key: 'http-accept-gzip', type: 'boolean', default: false },
    { key: 'httpNoCache', aria2Key: 'http-no-cache', type: 'boolean', default: false },
    { key: 'header', aria2Key: 'header', type: 'string', default: '' },
    { key: 'referer', aria2Key: 'referer', type: 'string', default: '' },
    { key: 'enableHttpKeepAlive', aria2Key: 'enable-http-keep-alive', type: 'boolean', default: true },
    { key: 'enableHttpPipelining', aria2Key: 'enable-http-pipelining', type: 'boolean', default: false },
    { key: 'contentDispositionDefaultUtf8', aria2Key: 'content-disposition-default-utf8', type: 'boolean', default: false },
    { key: 'checkCertificate', aria2Key: 'check-certificate', type: 'boolean', default: true },
    { key: 'minTlsVersion', aria2Key: 'min-tls-version', type: 'select', default: '' },
    { key: 'caCertificate', aria2Key: 'ca-certificate', type: 'string', default: '' },
    { key: 'certificate', aria2Key: 'certificate', type: 'string', default: '' },
    { key: 'privateKey', aria2Key: 'private-key', type: 'string', default: '' },
    { key: 'ftpUser', aria2Key: 'ftp-user', type: 'string', default: '' },
    { key: 'ftpPasswd', aria2Key: 'ftp-passwd', type: 'string', default: '' },
    { key: 'ftpType', aria2Key: 'ftp-type', type: 'select', default: 'binary' },
    { key: 'ftpPasv', aria2Key: 'ftp-pasv', type: 'boolean', default: true },
    { key: 'ftpReuseConnection', aria2Key: 'ftp-reuse-connection', type: 'boolean', default: true }
  ]
}

const { applyOptions, toOptions, defaults } = useSettingSchema(protocolSettingsSchema, form)

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
