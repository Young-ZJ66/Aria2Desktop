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
    <n-form
      ref="formRef"
      :model="settings"
      :rules="rules"
      label-placement="left"
      :label-width="180"
      label-align="left"
      :show-feedback="false"
    >
      <n-card :title="t('settings.metalink.groupBasic')" class="setting-group">
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

        <n-form-item path="metalinkBaseUri">
          <template #label>
            <TipLabel :label="t('settings.metalink.metalinkBaseUri')" :tip="t('settings.metalink.metalinkBaseUriTip')" />
          </template>
          <n-input v-model:value="settings.metalinkBaseUri" :placeholder="t('settings.metalink.metalinkBaseUriPlaceholder')" clearable />
        </n-form-item>
      </n-card>
    </n-form>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
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

// follow-metalink 选项标签本地化，跟随语言实时切换
const followMetalinkOptions = computed(() => [
  { label: t('settings.metalink.followMetalinkTrue'), value: 'true' },
  { label: t('settings.metalink.followMetalinkFalse'), value: 'false' },
  { label: t('settings.metalink.followMetalinkMem'), value: 'mem' }
])

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

// metalink-base-uri 校验：为空时跳过（让 aria2 保留旧值），非空时需为带协议头的合法 URL
function isValidBaseUri(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim())
}

// 表单验证规则
const rules: FormRules = {
  metalinkBaseUri: [
    { validator: (_rule, value) => (typeof value === 'string' && value.trim() && !isValidBaseUri(value) ? new Error(t('settings.invalidUrl')) : true), trigger: 'blur' }
  ]
}

// aria2 选项 <-> 表单字段 的 schema 声明：type 决定默认转换规则，本页全部走默认转换
const metalinkSettingsSchema: SettingSchema = {
  fields: [
    { key: 'followMetalink', aria2Key: 'follow-metalink', type: 'select', default: 'true' },
    { key: 'metalinkPreferredProtocol', aria2Key: 'metalink-preferred-protocol', type: 'string', default: 'https,http,ftp' },
    { key: 'metalinkEnableUniqueProtocol', aria2Key: 'metalink-enable-unique-protocol', type: 'boolean', default: true },
    { key: 'metalinkServers', aria2Key: 'metalink-servers', type: 'string', default: '' },
    { key: 'metalinkLanguage', aria2Key: 'metalink-language', type: 'string', default: 'zh-CN,en-US' },
    { key: 'metalinkLocation', aria2Key: 'metalink-location', type: 'string', default: 'CN,US' },
    { key: 'metalinkOs', aria2Key: 'metalink-os', type: 'string', default: 'linux,windows' },
    { key: 'metalinkVersion', aria2Key: 'metalink-version', type: 'string', default: '' },
    { key: 'metalinkBaseUri', aria2Key: 'metalink-base-uri', type: 'string', default: '' }
  ]
}

const { applyOptions, toOptions, defaults } = useSettingSchema(metalinkSettingsSchema, settings)

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

const { loading, saving, loadSettings, handleSave, handleReset } = useGlobalSettingsForm(settings, {
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
