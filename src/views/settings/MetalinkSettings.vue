<template>
  <SettingsPage
    :title="t('nav.metalinkSettings')"
    :description="t('settings.metalink.description')"
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
      <n-card :title="t('settings.metalink.groupBasic')" class="setting-group">
        <n-form label-placement="left" :label-width="180" :show-feedback="false" label-align="left">
          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.followMetalink')" :tip="t('settings.metalink.followMetalinkTip')" />
            </template>
            <n-select v-model:value="settings.followMetalink" :options="followMetalinkOptions" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.metalinkPreferredProtocol')" :tip="t('settings.metalink.metalinkPreferredProtocolTip')" />
            </template>
            <n-input v-model:value="settings.metalinkPreferredProtocol" :placeholder="t('settings.metalink.metalinkPreferredProtocolPlaceholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.metalinkEnableUniqueProtocol')" :tip="t('settings.metalink.metalinkEnableUniqueProtocolTip')" />
            </template>
            <AppSwitch v-model:value="settings.metalinkEnableUniqueProtocol" />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.metalinkServers')" :tip="t('settings.metalink.metalinkServersTip')" />
            </template>
            <n-input
              v-model:value="settings.metalinkServers"
              type="textarea"
              :autosize="{ minRows: 4, maxRows: 8 }"
              :placeholder="t('settings.metalink.metalinkServersPlaceholder')"
            />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.metalinkLanguage')" :tip="t('settings.metalink.metalinkLanguageTip')" />
            </template>
            <n-input v-model:value="settings.metalinkLanguage" :placeholder="t('settings.metalink.metalinkLanguagePlaceholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.metalinkLocation')" :tip="t('settings.metalink.metalinkLocationTip')" />
            </template>
            <n-input v-model:value="settings.metalinkLocation" :placeholder="t('settings.metalink.metalinkLocationPlaceholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.metalinkOs')" :tip="t('settings.metalink.metalinkOsTip')" />
            </template>
            <n-input v-model:value="settings.metalinkOs" :placeholder="t('settings.metalink.metalinkOsPlaceholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.metalinkVersion')" :tip="t('settings.metalink.metalinkVersionTip')" />
            </template>
            <n-input v-model:value="settings.metalinkVersion" :placeholder="t('settings.metalink.metalinkVersionPlaceholder')" clearable />
          </n-form-item>

          <n-form-item>
            <template #label>
              <TipLabel :label="t('settings.metalink.metalinkBaseUri')" :tip="t('settings.metalink.metalinkBaseUriTip')" />
            </template>
            <n-input v-model:value="settings.metalinkBaseUri" :placeholder="t('settings.metalink.metalinkBaseUriPlaceholder')" clearable />
          </n-form-item>
        </n-form>
      </n-card>
    </n-spin>
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

const loading = ref(false)
const saving = ref(false)

const followMetalinkOptions = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
  { label: 'mem', value: 'mem' }
]

const settings = reactive({
  followMetalink: 'true',
  metalinkPreferredProtocol: 'https,http,ftp',
  metalinkEnableUniqueProtocol: true,
  metalinkServers: '',
  metalinkLanguage: 'zh-CN,en-US',
  metalinkLocation: 'CN,US',
  metalinkOs: 'linux,windows',
  metalinkVersion: '',
  metalinkBaseUri: ''
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
      settings.followMetalink = options['follow-metalink'] || 'true'
      settings.metalinkPreferredProtocol = options['metalink-preferred-protocol'] || 'https,http,ftp'
      settings.metalinkEnableUniqueProtocol = options['metalink-enable-unique-protocol'] !== 'false'
      settings.metalinkServers = options['metalink-servers'] || ''
      settings.metalinkLanguage = options['metalink-language'] || 'zh-CN,en-US'
      settings.metalinkLocation = options['metalink-location'] || 'CN,US'
      settings.metalinkOs = options['metalink-os'] || 'linux,windows'
      settings.metalinkVersion = options['metalink-version'] || ''
      settings.metalinkBaseUri = options['metalink-base-uri'] || ''
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
    message.error(t('settings.loadFailed', { error: errorMessage }))
    console.error('Failed to load Metalink settings:', error)
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
      'follow-metalink': settings.followMetalink,
      'metalink-preferred-protocol': settings.metalinkPreferredProtocol,
      'metalink-enable-unique-protocol': settings.metalinkEnableUniqueProtocol ? 'true' : 'false',
      'metalink-language': settings.metalinkLanguage,
      'metalink-location': settings.metalinkLocation,
      'metalink-os': settings.metalinkOs
    }

    if (settings.metalinkServers) options['metalink-servers'] = settings.metalinkServers
    if (settings.metalinkVersion) options['metalink-version'] = settings.metalinkVersion
    if (settings.metalinkBaseUri) options['metalink-base-uri'] = settings.metalinkBaseUri

    await statsStore.changeGlobalOptions(options)
    message.success(t('settings.saved'))
  } catch (error) {
    message.error(t('settings.saveFailedShort'))
    console.error('Failed to save Metalink settings:', error)
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
      settings.followMetalink = 'true'
      settings.metalinkPreferredProtocol = 'https,http,ftp'
      settings.metalinkEnableUniqueProtocol = true
      settings.metalinkServers = ''
      settings.metalinkLanguage = 'zh-CN,en-US'
      settings.metalinkLocation = 'CN,US'
      settings.metalinkOs = 'linux,windows'
      settings.metalinkVersion = ''
      settings.metalinkBaseUri = ''

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
