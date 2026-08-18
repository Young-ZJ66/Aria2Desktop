<template>
  <SettingsPage
    :title="t('nav.metalinkSettings')"
    :description="t('settings.metalink.description')"
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
import { useGlobalSettingsForm } from '@/composables/useGlobalSettingsForm'

const { t } = useI18n()
const connectionStore = useConnectionStore()

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

function applyOptionsToSettings(options: Aria2Option) {
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

function toOptions(): Record<string, string> {
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
  return options
}

function defaults() {
  return {
    followMetalink: 'true',
    metalinkPreferredProtocol: 'https,http,ftp',
    metalinkEnableUniqueProtocol: true,
    metalinkServers: '',
    metalinkLanguage: 'zh-CN,en-US',
    metalinkLocation: 'CN,US',
    metalinkOs: 'linux,windows',
    metalinkVersion: '',
    metalinkBaseUri: ''
  }
}

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(settings, {
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
