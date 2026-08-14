<template>
  <el-dialog
    v-model="visible"
    :title="t('connection.title')"
    width="500px"
    :close-on-click-modal="false"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
    >
      <el-form-item :label="t('connection.protocol')" prop="protocol">
        <el-select v-model="form.protocol" style="width: 100%">
          <el-option label="HTTP" value="http" />
          <el-option label="HTTPS" value="https" />
          <el-option label="WebSocket" value="ws" />
          <el-option label="WebSocket Secure" value="wss" />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('connection.host')" prop="host">
        <el-input v-model="form.host" :placeholder="t('connection.hostPlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('connection.port')" prop="port">
        <el-input-number
          v-model="form.port"
          :min="1"
          :max="65535"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item :label="t('connection.path')" prop="path">
        <el-input v-model="form.path" :placeholder="t('connection.pathPlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('connection.secret')" prop="secret">
        <el-input
          v-model="form.secret"
          type="password"
          :placeholder="t('connection.secretPlaceholder')"
          show-password
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          :loading="connecting"
          @click="handleConnect"
        >
          {{ connecting ? t('connection.connectingText') : t('connection.connect') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
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
const formRef = ref<FormInstance>()
const connecting = ref(false)

const visible = ref(props.modelValue)
const form = reactive<Aria2Config>({
  protocol: 'http',
  host: 'localhost',
  port: 6800,
  path: '/jsonrpc',
  secret: ''
})

const rules = computed<FormRules>(() => ({
  host: [
    { required: true, message: t('connection.requireHost'), trigger: 'blur' }
  ],
  port: [
    { required: true, message: t('connection.requirePort'), trigger: 'blur' },
    { type: 'number', min: 1, max: 65535, message: t('connection.portRange'), trigger: 'blur' }
  ]
}))

// 监听props变化
watch(() => props.modelValue, (newVal) => {
  visible.value = newVal
  if (newVal) {
    // 打开对话框时，加载当前配置
    Object.assign(form, connectionStore.config)
  }
})

// 监听visible变化
watch(visible, (newVal) => {
  emit('update:modelValue', newVal)
})

async function handleConnect() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()

    connecting.value = true

    await connectionStore.connect(form)

    ElMessage.success(t('connection.connectSuccess'))
    visible.value = false
  } catch (error) {
    console.error('Connection failed:', error)
    ElMessage.error(error instanceof Error ? error.message : t('connection.connectionFailed'))
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
