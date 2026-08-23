<template>
  <SettingsPage
    :title="t('nav.networkSettings')"
    :description="t('settings.network.description')"
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
      <n-card :title="t('settings.network.groupTimeoutRetry')" class="setting-group">
        <n-form-item path="timeout">
          <template #label>
            <TipLabel :label="t('settings.network.timeout')" :tip="t('settings.network.timeoutTip')" />
          </template>
          <n-input-number
            v-model:value="form.timeout"
            :min="1"
            :max="600"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="connectTimeout">
          <template #label>
            <TipLabel :label="t('settings.network.connectTimeout')" :tip="t('settings.network.connectTimeoutTip')" />
          </template>
          <n-input-number
            v-model:value="form.connectTimeout"
            :min="1"
            :max="600"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="maxTries">
          <template #label>
            <TipLabel :label="t('settings.network.maxTries')" :tip="t('settings.network.maxTriesTip')" />
          </template>
          <n-input-number
            v-model:value="form.maxTries"
            :min="0"
            :max="100"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="retryWait">
          <template #label>
            <TipLabel :label="t('settings.network.retryWait')" :tip="t('settings.network.retryWaitTip')" />
          </template>
          <n-input-number
            v-model:value="form.retryWait"
            :min="0"
            :max="600"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="maxFileNotFound">
          <template #label>
            <TipLabel :label="t('settings.network.maxFileNotFound')" :tip="t('settings.network.maxFileNotFoundTip')" />
          </template>
          <n-input-number
            v-model:value="form.maxFileNotFound"
            :min="0"
            :max="1000"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-card>

      <n-card :title="t('settings.network.groupConnection')" class="setting-group">
        <n-form-item path="lowestSpeedLimit">
          <template #label>
            <TipLabel :label="t('settings.network.lowestSpeedLimit')" :tip="t('settings.network.lowestSpeedLimitTip')" />
          </template>
          <n-input-number
            v-model:value="form.lowestSpeedLimit"
            :min="0"
            :placeholder="t('settings.network.noLimit')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.noProxy')" :tip="t('settings.network.noProxyTip')" />
          </template>
          <n-input
            v-model:value="form.noProxy"
            placeholder="localhost,127.0.0.1,*.local"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.interface')" :tip="t('settings.network.interfaceTip')" />
          </template>
          <n-input
            v-model:value="form.interface"
            :placeholder="t('settings.network.interfacePlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-card>

      <n-card :title="t('settings.network.groupProxy')" class="setting-group">
        <n-form-item path="allProxy">
          <template #label>
            <TipLabel :label="t('settings.network.allProxy')" :tip="t('settings.network.allProxyTip')" />
          </template>
          <n-input
            v-model:value="form.allProxy"
            placeholder="http://proxy.example.com:8080"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.allProxyUser')" />
          </template>
          <n-input
            v-model:value="form.allProxyUser"
            :placeholder="t('settings.network.allProxyUserPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.allProxyPasswd')" />
          </template>
          <n-input
            v-model:value="form.allProxyPasswd"
            type="password"
            show-password-on="click"
            :placeholder="t('settings.network.allProxyPasswdPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="httpProxy">
          <template #label>
            <TipLabel :label="t('settings.network.httpProxy')" :tip="t('settings.network.httpProxyTip')" />
          </template>
          <n-input
            v-model:value="form.httpProxy"
            placeholder="http://proxy.example.com:8080"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.httpProxyUser')" />
          </template>
          <n-input
            v-model:value="form.httpProxyUser"
            :placeholder="t('settings.network.httpProxyUserPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.httpProxyPasswd')" />
          </template>
          <n-input
            v-model:value="form.httpProxyPasswd"
            type="password"
            show-password-on="click"
            :placeholder="t('settings.network.httpProxyPasswdPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="httpsProxy">
          <template #label>
            <TipLabel :label="t('settings.network.httpsProxy')" :tip="t('settings.network.httpsProxyTip')" />
          </template>
          <n-input
            v-model:value="form.httpsProxy"
            placeholder="https://proxy.example.com:8080"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.httpsProxyUser')" />
          </template>
          <n-input
            v-model:value="form.httpsProxyUser"
            :placeholder="t('settings.network.httpsProxyUserPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.httpsProxyPasswd')" />
          </template>
          <n-input
            v-model:value="form.httpsProxyPasswd"
            type="password"
            show-password-on="click"
            :placeholder="t('settings.network.httpsProxyPasswdPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="ftpProxy">
          <template #label>
            <TipLabel :label="t('settings.network.ftpProxy')" :tip="t('settings.network.ftpProxyTip')" />
          </template>
          <n-input
            v-model:value="form.ftpProxy"
            placeholder="ftp://proxy.example.com:21"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.ftpProxyUser')" />
          </template>
          <n-input
            v-model:value="form.ftpProxyUser"
            :placeholder="t('settings.network.ftpProxyUserPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.ftpProxyPasswd')" />
          </template>
          <n-input
            v-model:value="form.ftpProxyPasswd"
            type="password"
            show-password-on="click"
            :placeholder="t('settings.network.ftpProxyPasswdPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-card>

      <n-card :title="t('settings.network.groupNetwork')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.proxyMethod')" :tip="t('settings.network.proxyMethodTip')" />
          </template>
          <n-select
            v-model:value="form.proxyMethod"
            :options="proxyMethodOptions"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.disableIpv6')" :tip="t('settings.network.disableIpv6Tip')" />
          </template>
          <AppSwitch
            v-model:value="form.disableIpv6"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.serverStatOf')" :tip="t('settings.network.serverStatOfTip')" />
          </template>
          <n-input
            v-model:value="form.serverStatOf"
            :placeholder="t('settings.network.serverStatOfPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.serverStatIf')" :tip="t('settings.network.serverStatIfTip')" />
          </template>
          <n-input
            v-model:value="form.serverStatIf"
            :placeholder="t('settings.network.serverStatIfPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="serverStatTimeout">
          <template #label>
            <TipLabel :label="t('settings.network.serverStatTimeout')" :tip="t('settings.network.serverStatTimeoutTip')" />
          </template>
          <n-input-number
            v-model:value="form.serverStatTimeout"
            :min="0"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.asyncDns')" :tip="t('settings.network.asyncDnsTip')" />
          </template>
          <AppSwitch
            v-model:value="form.asyncDns"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.network.asyncDnsServer')" :tip="t('settings.network.asyncDnsServerTip')" />
          </template>
          <n-input
            v-model:value="form.asyncDnsServer"
            :placeholder="t('settings.network.asyncDnsServerPlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>

        <n-form-item path="socketRecvBufferSize">
          <template #label>
            <TipLabel :label="t('settings.network.socketRecvBufferSize')" :tip="t('settings.network.socketRecvBufferSizeTip')" />
          </template>
          <n-input-number
            v-model:value="form.socketRecvBufferSize"
            :min="0"
            :placeholder="t('settings.network.socketRecvBufferSizePlaceholder')"
            :disabled="!connectionStore.isConnected"
          />
        </n-form-item>
      </n-card>
    </n-form>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
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

const proxyMethodOptions = [
  { label: 'get', value: 'get' },
  { label: 'tunnel', value: 'tunnel' }
]

const form = reactive({
  timeout: 60,
  connectTimeout: 60,
  maxTries: 5,
  retryWait: 0,
  maxFileNotFound: 0,
  lowestSpeedLimit: 0,
  noProxy: '',
  interface: '',
  allProxy: '',
  allProxyUser: '',
  allProxyPasswd: '',
  httpProxy: '',
  httpProxyUser: '',
  httpProxyPasswd: '',
  httpsProxy: '',
  httpsProxyUser: '',
  httpsProxyPasswd: '',
  ftpProxy: '',
  ftpProxyUser: '',
  ftpProxyPasswd: '',
  proxyMethod: 'get',
  disableIpv6: false,
  serverStatOf: '',
  serverStatIf: '',
  serverStatTimeout: 86400,
  asyncDns: true,
  asyncDnsServer: '',
  socketRecvBufferSize: 0
})

// 代理地址校验：为空时跳过（让 aria2 保留旧值），非空时需为带协议头的合法 URL
function isValidProxyUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(value.trim())
}

// 表单验证规则
const rules: FormRules = {
  timeout: [
    { type: 'number', min: 1, max: 600, message: () => t('settings.valueRange', { min: 1, max: 600 }), trigger: 'blur' }
  ],
  connectTimeout: [
    { type: 'number', min: 1, max: 600, message: () => t('settings.valueRange', { min: 1, max: 600 }), trigger: 'blur' }
  ],
  maxTries: [
    { type: 'number', min: 0, max: 100, message: () => t('settings.valueRange', { min: 0, max: 100 }), trigger: 'blur' }
  ],
  retryWait: [
    { type: 'number', min: 0, max: 600, message: () => t('settings.valueRange', { min: 0, max: 600 }), trigger: 'blur' }
  ],
  maxFileNotFound: [
    { type: 'number', min: 0, max: 1000, message: () => t('settings.valueRange', { min: 0, max: 1000 }), trigger: 'blur' }
  ],
  lowestSpeedLimit: [
    { type: 'number', min: 0, message: () => t('settings.valueMin', { min: 0 }), trigger: 'blur' }
  ],
  allProxy: [
    { validator: (_rule, value) => (typeof value === 'string' && value.trim() && !isValidProxyUrl(value) ? new Error(t('settings.invalidUrl')) : true), trigger: 'blur' }
  ],
  httpProxy: [
    { validator: (_rule, value) => (typeof value === 'string' && value.trim() && !isValidProxyUrl(value) ? new Error(t('settings.invalidUrl')) : true), trigger: 'blur' }
  ],
  httpsProxy: [
    { validator: (_rule, value) => (typeof value === 'string' && value.trim() && !isValidProxyUrl(value) ? new Error(t('settings.invalidUrl')) : true), trigger: 'blur' }
  ],
  ftpProxy: [
    { validator: (_rule, value) => (typeof value === 'string' && value.trim() && !isValidProxyUrl(value) ? new Error(t('settings.invalidUrl')) : true), trigger: 'blur' }
  ],
  serverStatTimeout: [
    { type: 'number', min: 0, message: () => t('settings.valueMin', { min: 0 }), trigger: 'blur' }
  ],
  socketRecvBufferSize: [
    { type: 'number', min: 0, message: () => t('settings.valueMin', { min: 0 }), trigger: 'blur' }
  ]
}

// aria2 选项 <-> 表单字段 的 schema 声明：type 决定默认转换规则，
// 特殊字段可用 optionToValue/valueToOption 覆盖（本例全部走默认转换）
const networkSettingsSchema: SettingSchema = {
  fields: [
    { key: 'timeout', aria2Key: 'timeout', type: 'number', default: 60 },
    { key: 'connectTimeout', aria2Key: 'connect-timeout', type: 'number', default: 60 },
    { key: 'maxTries', aria2Key: 'max-tries', type: 'number', default: 5 },
    { key: 'retryWait', aria2Key: 'retry-wait', type: 'number', default: 0 },
    { key: 'maxFileNotFound', aria2Key: 'max-file-not-found', type: 'number', default: 0 },
    { key: 'lowestSpeedLimit', aria2Key: 'lowest-speed-limit', type: 'size', default: 0, unit: 'K' },
    { key: 'noProxy', aria2Key: 'no-proxy', type: 'string', default: '' },
    { key: 'interface', aria2Key: 'interface', type: 'string', default: '' },
    { key: 'allProxy', aria2Key: 'all-proxy', type: 'string', default: '' },
    { key: 'allProxyUser', aria2Key: 'all-proxy-user', type: 'string', default: '' },
    { key: 'allProxyPasswd', aria2Key: 'all-proxy-passwd', type: 'string', default: '' },
    { key: 'httpProxy', aria2Key: 'http-proxy', type: 'string', default: '' },
    { key: 'httpProxyUser', aria2Key: 'http-proxy-user', type: 'string', default: '' },
    { key: 'httpProxyPasswd', aria2Key: 'http-proxy-passwd', type: 'string', default: '' },
    { key: 'httpsProxy', aria2Key: 'https-proxy', type: 'string', default: '' },
    { key: 'httpsProxyUser', aria2Key: 'https-proxy-user', type: 'string', default: '' },
    { key: 'httpsProxyPasswd', aria2Key: 'https-proxy-passwd', type: 'string', default: '' },
    { key: 'ftpProxy', aria2Key: 'ftp-proxy', type: 'string', default: '' },
    { key: 'ftpProxyUser', aria2Key: 'ftp-proxy-user', type: 'string', default: '' },
    { key: 'ftpProxyPasswd', aria2Key: 'ftp-proxy-passwd', type: 'string', default: '' },
    { key: 'proxyMethod', aria2Key: 'proxy-method', type: 'select', default: 'get' },
    { key: 'disableIpv6', aria2Key: 'disable-ipv6', type: 'boolean', default: false },
    { key: 'serverStatOf', aria2Key: 'server-stat-of', type: 'string', default: '' },
    { key: 'serverStatIf', aria2Key: 'server-stat-if', type: 'string', default: '' },
    { key: 'serverStatTimeout', aria2Key: 'server-stat-timeout', type: 'number', default: 86400 },
    { key: 'asyncDns', aria2Key: 'async-dns', type: 'boolean', default: true },
    { key: 'asyncDnsServer', aria2Key: 'async-dns-server', type: 'string', default: '' },
    { key: 'socketRecvBufferSize', aria2Key: 'socket-recv-buffer-size', type: 'size', default: 0, unit: 'K' }
  ]
}

const { applyOptions, toOptions, defaults } = useSettingSchema(networkSettingsSchema, form)

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
</script>

<style scoped>
.setting-group {
  margin-bottom: 16px;
}
</style>
