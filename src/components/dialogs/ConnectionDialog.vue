<template>
  <el-dialog
    v-model="visible"
    title="连接设置"
    width="500px"
    :close-on-click-modal="false"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
    >
      <el-form-item label="协议" prop="protocol">
        <el-select v-model="form.protocol" style="width: 100%">
          <el-option label="HTTP" value="http" />
          <el-option label="HTTPS" value="https" />
          <el-option label="WebSocket" value="ws" />
          <el-option label="WebSocket Secure" value="wss" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="主机" prop="host">
        <el-input v-model="form.host" placeholder="localhost" />
      </el-form-item>
      
      <el-form-item label="端口" prop="port">
        <el-input-number 
          v-model="form.port" 
          :min="1" 
          :max="65535" 
          style="width: 100%"
        />
      </el-form-item>
      
      <el-form-item label="路径" prop="path">
        <el-input v-model="form.path" placeholder="/jsonrpc" />
      </el-form-item>
      
      <el-form-item label="密钥" prop="secret">
        <el-input 
          v-model="form.secret" 
          type="password" 
          placeholder="可选，RPC密钥"
          show-password
        />
      </el-form-item>
    </el-form>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button 
          type="primary" 
          :loading="connecting"
          @click="handleConnect"
        >
          {{ connecting ? '连接中...' : '连接' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAria2Store } from '@/stores/aria2Store'
import type { Aria2Config } from '@/types/aria2'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const aria2Store = useAria2Store()
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

const rules: FormRules = {
  host: [
    { required: true, message: '请输入主机地址', trigger: 'blur' }
  ],
  port: [
    { required: true, message: '请输入端口号', trigger: 'blur' },
    { type: 'number', min: 1, max: 65535, message: '端口号必须在1-65535之间', trigger: 'blur' }
  ]
}

// 监听props变化
watch(() => props.modelValue, (newVal) => {
  visible.value = newVal
  if (newVal) {
    // 打开对话框时，加载当前配置
    Object.assign(form, aria2Store.config)
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
    
    await aria2Store.connect(form)
    
    ElMessage.success('连接成功')
    visible.value = false
    
  } catch (error) {
    console.error('Connection failed:', error)
    ElMessage.error(error instanceof Error ? error.message : '连接失败')
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
