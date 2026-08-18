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
    <n-card :title="t('settings.network.groupTimeoutRetry')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
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

        <n-form-item>
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

        <n-form-item>
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

        <n-form-item>
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

        <n-form-item>
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
      </n-form>
    </n-card>

    <n-card :title="t('settings.network.groupConnection')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
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
      </n-form>
    </n-card>

    <n-card :title="t('settings.network.groupProxy')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
        <n-form-item>
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

        <n-form-item>
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

        <n-form-item>
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

        <n-form-item>
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
      </n-form>
    </n-card>

    <n-card :title="t('settings.network.groupNetwork')" class="setting-group">
      <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
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

        <n-form-item>
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

        <n-form-item>
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
      </n-form>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import type { Aria2Option } from '@/types/aria2'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connectionStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { parseSizeToUnit, formatSizeWithUnit } from '@/utils/size'
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'

const { t } = useI18n()
const connectionStore = useConnectionStore()

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

function applyOptionsToSettings(options: Aria2Option) {
  form.timeout = parseInt(options['timeout'] || '60')
  form.connectTimeout = parseInt(options['connect-timeout'] || '60')
  form.maxTries = parseInt(options['max-tries'] || '5')
  form.retryWait = parseInt(options['retry-wait'] || '0')
  form.maxFileNotFound = parseInt(options['max-file-not-found'] || '0')
  form.lowestSpeedLimit = parseSizeToUnit(options['lowest-speed-limit'] || '0', 'K')
  form.noProxy = options['no-proxy'] || ''
  form.interface = options['interface'] || ''
  form.allProxy = options['all-proxy'] || ''
  form.allProxyUser = options['all-proxy-user'] || ''
  form.allProxyPasswd = options['all-proxy-passwd'] || ''
  form.httpProxy = options['http-proxy'] || ''
  form.httpProxyUser = options['http-proxy-user'] || ''
  form.httpProxyPasswd = options['http-proxy-passwd'] || ''
  form.httpsProxy = options['https-proxy'] || ''
  form.httpsProxyUser = options['https-proxy-user'] || ''
  form.httpsProxyPasswd = options['https-proxy-passwd'] || ''
  form.ftpProxy = options['ftp-proxy'] || ''
  form.ftpProxyUser = options['ftp-proxy-user'] || ''
  form.ftpProxyPasswd = options['ftp-proxy-passwd'] || ''
  form.proxyMethod = options['proxy-method'] || 'get'
  form.disableIpv6 = options['disable-ipv6'] === 'true'
  form.serverStatOf = options['server-stat-of'] || ''
  form.serverStatIf = options['server-stat-if'] || ''
  form.serverStatTimeout = parseInt(options['server-stat-timeout'] || '86400')
  form.asyncDns = options['async-dns'] !== 'false'
  form.asyncDnsServer = options['async-dns-server'] || ''
  form.socketRecvBufferSize = parseSizeToUnit(options['socket-recv-buffer-size'] || '0', 'K')
}

function toOptions(): Record<string, string> {
  const options: Record<string, string> = {
    'timeout': form.timeout.toString(),
    'connect-timeout': form.connectTimeout.toString(),
    'max-tries': form.maxTries.toString(),
    'retry-wait': form.retryWait.toString(),
    'max-file-not-found': form.maxFileNotFound.toString(),
    'lowest-speed-limit': formatSizeWithUnit(form.lowestSpeedLimit, 'K'),
    'proxy-method': form.proxyMethod,
    'disable-ipv6': form.disableIpv6 ? 'true' : 'false',
    'server-stat-timeout': form.serverStatTimeout.toString(),
    'async-dns': form.asyncDns ? 'true' : 'false',
    'socket-recv-buffer-size': formatSizeWithUnit(form.socketRecvBufferSize, 'K')
  }

  if (form.noProxy) options['no-proxy'] = form.noProxy
  if (form.interface) options['interface'] = form.interface
  if (form.allProxy) options['all-proxy'] = form.allProxy
  if (form.allProxyUser) options['all-proxy-user'] = form.allProxyUser
  if (form.allProxyPasswd) options['all-proxy-passwd'] = form.allProxyPasswd
  if (form.httpProxy) options['http-proxy'] = form.httpProxy
  if (form.httpProxyUser) options['http-proxy-user'] = form.httpProxyUser
  if (form.httpProxyPasswd) options['http-proxy-passwd'] = form.httpProxyPasswd
  if (form.httpsProxy) options['https-proxy'] = form.httpsProxy
  if (form.httpsProxyUser) options['https-proxy-user'] = form.httpsProxyUser
  if (form.httpsProxyPasswd) options['https-proxy-passwd'] = form.httpsProxyPasswd
  if (form.ftpProxy) options['ftp-proxy'] = form.ftpProxy
  if (form.ftpProxyUser) options['ftp-proxy-user'] = form.ftpProxyUser
  if (form.ftpProxyPasswd) options['ftp-proxy-passwd'] = form.ftpProxyPasswd
  if (form.serverStatOf) options['server-stat-of'] = form.serverStatOf
  if (form.serverStatIf) options['server-stat-if'] = form.serverStatIf
  if (form.asyncDnsServer) options['async-dns-server'] = form.asyncDnsServer
  return options
}

function defaults() {
  return {
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
  }
}

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(form, {
  applyOptions: applyOptionsToSettings,
  toOptions,
  defaults
})
</script>

<style scoped>
.setting-group {
  margin-bottom: 16px;
}
</style>
