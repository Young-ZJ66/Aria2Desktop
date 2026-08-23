<template>
  <SettingsPage
    :title="t('nav.rpcSecuritySettings')"
    :description="t('settings.rpc.description')"
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
      <n-card :title="t('settings.rpc.groupService')" class="setting-group">
        <n-form-item>
          <template #label>
            <TipLabel :label="t('settings.rpc.enableRpc')" :tip="t('settings.rpc.enableRpcTip')" />
          </template>
          <AppSwitch v-model:value="settings.enableRpc" />
        </n-form-item>

        <n-form-item path="rpcListenPort">
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

        <n-form-item path="rpcMaxRequestSize">
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
      </n-card>

      <!-- RPC 安全 -->
      <n-card :title="t('settings.rpc.groupSecurity')" class="setting-group">
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
      </n-card>

      <!-- TLS 加密 -->
      <n-card :title="t('settings.rpc.groupTls')" class="setting-group">
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
      </n-card>
    </n-form>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
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

const settings = reactive({
  enableRpc: true,
  rpcListenPort: 6800,
  rpcListenAll: false,
  rpcSecret: '',
  rpcAllowOriginAll: true,
  rpcMaxRequestSize: '2M',
  rpcSaveUploadMetadata: true,
  rpcCertificate: '',
  rpcPrivateKey: '',
  forceSave: false,
  pauseMetadata: false
})

// 表单验证规则
const rules: FormRules = {
  // RPC 监听端口取值范围 1024-65535
  rpcListenPort: [
    { type: 'number', min: 1024, max: 65535, message: () => t('settings.valueRange', { min: 1024, max: 65535 }), trigger: 'blur' }
  ],
  // rpc-max-request-size 单位 M，0 表示默认限制，仅校验非负
  rpcMaxRequestSize: [
    { type: 'number', min: 0, message: () => t('settings.valueMin', { min: 0 }), trigger: 'blur' }
  ]
}

// aria2 选项 <-> 表单字段 的 schema 声明：type 决定默认转换规则，
// rpc-allow-origin-all 原转换语义为「只有显式 'true' 才启用」（未返回时视为关闭），
// 与默认值 true 不一致，保留自定义 optionToValue 维持原有行为
const rpcSecuritySettingsSchema: SettingSchema = {
  fields: [
    { key: 'enableRpc', aria2Key: 'enable-rpc', type: 'boolean', default: true },
    { key: 'rpcListenPort', aria2Key: 'rpc-listen-port', type: 'number', default: 6800 },
    { key: 'rpcListenAll', aria2Key: 'rpc-listen-all', type: 'boolean', default: false },
    { key: 'rpcSecret', aria2Key: 'rpc-secret', type: 'string', default: '' },
    { key: 'rpcAllowOriginAll', aria2Key: 'rpc-allow-origin-all', type: 'boolean', default: true, optionToValue: (raw) => raw === 'true' },
    { key: 'rpcMaxRequestSize', aria2Key: 'rpc-max-request-size', type: 'size', default: 2, unit: 'M' },
    { key: 'rpcSaveUploadMetadata', aria2Key: 'rpc-save-upload-metadata', type: 'boolean', default: true },
    { key: 'rpcCertificate', aria2Key: 'rpc-certificate', type: 'string', default: '' },
    { key: 'rpcPrivateKey', aria2Key: 'rpc-private-key', type: 'string', default: '' },
    { key: 'forceSave', aria2Key: 'force-save', type: 'boolean', default: false },
    { key: 'pauseMetadata', aria2Key: 'pause-metadata', type: 'boolean', default: false }
  ]
}

const { applyOptions, toOptions, defaults } = useSettingSchema(rpcSecuritySettingsSchema, settings)

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
