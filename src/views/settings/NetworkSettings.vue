<template>
  <SettingsPage
    :title="t('nav.networkSettings')"
    :description="t('settings.network.description')"
    :show-connect-alert="true"
    :connected="connectionStore.isConnected"
    :show-actions="true"
    :saving="saving"
    :disabled="!connectionStore.isConnected"
    @save="handleSave"
    @reload="handleReload"
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
          <n-input
            v-model:value="form.lowestSpeedLimit"
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
            <TipLabel :label="t('settings.network.ftpProxy')" :tip="t('settings.network.ftpProxyTip')" />
          </template>
          <n-input
            v-model:value="form.ftpProxy"
            placeholder="ftp://proxy.example.com:21"
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
      </n-form>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { message, dialog } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'

const { t } = useI18n()
const connectionStore = useConnectionStore()
const statsStore = useStatsStore()

const saving = ref(false)

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
  lowestSpeedLimit: '0',
  noProxy: '',
  allProxy: '',
  allProxyUser: '',
  allProxyPasswd: '',
  httpProxy: '',
  httpsProxy: '',
  ftpProxy: '',
  proxyMethod: 'get',
  disableIpv6: false
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
      form.timeout = parseInt(options['timeout'] || '60')
      form.connectTimeout = parseInt(options['connect-timeout'] || '60')
      form.maxTries = parseInt(options['max-tries'] || '5')
      form.retryWait = parseInt(options['retry-wait'] || '0')
      form.maxFileNotFound = parseInt(options['max-file-not-found'] || '0')
      form.lowestSpeedLimit = options['lowest-speed-limit'] || '0'
      form.noProxy = options['no-proxy'] || ''
      form.allProxy = options['all-proxy'] || ''
      form.allProxyUser = options['all-proxy-user'] || ''
      form.allProxyPasswd = options['all-proxy-passwd'] || ''
      form.httpProxy = options['http-proxy'] || ''
      form.httpsProxy = options['https-proxy'] || ''
      form.ftpProxy = options['ftp-proxy'] || ''
      form.proxyMethod = options['proxy-method'] || 'get'
      form.disableIpv6 = options['disable-ipv6'] === 'true'
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
    message.error(t('settings.loadFailed', { error: errorMessage }))
    console.error('Failed to load network settings:', error)
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
      'timeout': form.timeout.toString(),
      'connect-timeout': form.connectTimeout.toString(),
      'max-tries': form.maxTries.toString(),
      'retry-wait': form.retryWait.toString(),
      'max-file-not-found': form.maxFileNotFound.toString(),
      'lowest-speed-limit': form.lowestSpeedLimit,
      'proxy-method': form.proxyMethod,
      'disable-ipv6': form.disableIpv6 ? 'true' : 'false'
    }

    if (form.noProxy) options['no-proxy'] = form.noProxy
    if (form.allProxy) options['all-proxy'] = form.allProxy
    if (form.allProxyUser) options['all-proxy-user'] = form.allProxyUser
    if (form.allProxyPasswd) options['all-proxy-passwd'] = form.allProxyPasswd
    if (form.httpProxy) options['http-proxy'] = form.httpProxy
    if (form.httpsProxy) options['https-proxy'] = form.httpsProxy
    if (form.ftpProxy) options['ftp-proxy'] = form.ftpProxy

    await statsStore.changeGlobalOptions(options)
    message.success(t('settings.saved'))
  } catch (error) {
    message.error(t('settings.saveFailedShort'))
    console.error('Failed to save network settings:', error)
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
        timeout: 60,
        connectTimeout: 60,
        maxTries: 5,
        retryWait: 0,
        maxFileNotFound: 0,
        lowestSpeedLimit: '0',
        noProxy: '',
        allProxy: '',
        allProxyUser: '',
        allProxyPasswd: '',
        httpProxy: '',
        httpsProxy: '',
        ftpProxy: '',
        proxyMethod: 'get',
        disableIpv6: false
      })
      message.success(t('settings.restored'))
    }
  })
}
</script>

<style scoped>
.setting-group {
  margin-bottom: 16px;
}
</style>
