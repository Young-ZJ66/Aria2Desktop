<template>
  <n-modal
    v-model:show="visible"
    :title="t('connection.title')"
    preset="card"
    style="width: 500px"
    :bordered="false"
    :mask-closable="false"
  >
    <n-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-placement="left"
      :label-width="100"
    >
      <n-form-item :label="t('connection.protocol')" path="protocol">
        <n-select v-model:value="form.protocol" :options="protocolOptions" style="width: 100%" />
      </n-form-item>
      <n-form-item :label="t('connection.host')" path="host">
        <n-input v-model:value="form.host" :placeholder="t('connection.hostPlaceholder')" />
      </n-form-item>
      <n-form-item :label="t('connection.port')" path="port">
        <n-input-number
          v-model:value="form.port"
          :min="1"
          :max="65535"
          style="width: 100%"
        />
      </n-form-item>
      <n-form-item :label="t('connection.path')" path="path">
        <n-input v-model:value="form.path" :placeholder="t('connection.pathPlaceholder')" />
      </n-form-item>
      <n-form-item :label="t('connection.secret')" path="secret">
        <n-input
          v-model:value="form.secret"
          type="password"
          :placeholder="t('connection.secretPlaceholder')"
          show-password-on="click"
        />
      </n-form-item>
    </n-form>

    <template #footer>
      <div class="dialog-footer">
        <n-space justify="end">
          <n-button @click="visible = false">{{ t('common.cancel') }}</n-button>
          <n-button
            type="primary"
            :loading="connecting"
            @click="handleConnect"
          >
            {{ connecting ? t('connection.connectingText') : t('connection.connect') }}
          </n-button>
        </n-space>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import type { FormInst, FormRules } from 'naive-ui'
import { useConnectionStore } from '@/stores/connectionStore'
import type { Aria2Config } from '@/types/aria2'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const { t } = useI18n()
const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const connectionStore = useConnectionStore()
const formRef = ref<FormInst>()
const connecting = ref(false)

const protocolOptions = [
  { label: 'HTTP', value: 'http' },
  { label: 'HTTPS', value: 'https' },
  { label: 'WebSocket', value: 'ws' },
  { label: 'WebSocket Secure', value: 'wss' }
]

// v-model 转发：打开时加载当前连接配置
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => {
    if (value) {
      Object.assign(form, connectionStore.config)
    }
    emit('update:modelValue', value)
  }
})

const form = reactive<Aria2Config>({
  protocol: 'http',
  host: 'localhost',
  port: 6800,
  path: '/jsonrpc',
  secret: ''
})

const rules = computed<FormRules>(() => ({
  host: [
    { required: true, message: () => t('connection.requireHost'), trigger: 'blur' }
  ],
  port: [
    { required: true, type: 'number', message: () => t('connection.requirePort'), trigger: 'blur' },
    { type: 'number', min: 1, max: 65535, message: () => t('connection.portRange'), trigger: 'blur' }
  ]
}))

async function handleConnect() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()

    connecting.value = true

    await connectionStore.connect(form)

    message.success(t('connection.connectSuccess'))
    visible.value = false
  } catch (error) {
    console.error('Connection failed:', error)
    message.error(error instanceof Error ? error.message : t('connection.connectionFailed'))
  } finally {
    connecting.value = false
  }
}
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
