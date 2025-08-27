<template>
  <div class="rpc-settings">
    <div class="settings-header">
      <h2>RPC 连接设置</h2>
      <p class="settings-description">配置与 Aria2 服务器的连接参数</p>
    </div>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="150px"
      style="max-width: 600px"
      v-loading="loading"
    >
      <el-card class="setting-group">
        <template #header>
          <div class="connection-header">
            <span class="group-title">连接配置</span>
            <el-tag
              :type="connectionStatus.type"
              size="small"
            >
              {{ connectionStatus.text }}
            </el-tag>
          </div>
        </template>

        <el-form-item label="协议" prop="protocol">
          <el-select v-model="form.protocol" style="width: 100%">
            <el-option label="HTTP" value="http" />
            <el-option label="HTTPS" value="https" />
            <el-option label="WebSocket" value="ws" />
            <el-option label="WebSocket Secure" value="wss" />
          </el-select>
          <div class="form-tip">推荐使用 WebSocket 以获得实时通知</div>
        </el-form-item>

        <el-form-item label="主机地址" prop="host">
          <el-input
            v-model="form.host"
            placeholder="localhost 或 IP 地址"
          />
          <div class="form-tip">Aria2 服务器的主机地址</div>
        </el-form-item>

        <el-form-item label="端口" prop="port">
          <el-input-number
            v-model="form.port"
            :min="1"
            :max="65535"
            style="width: 100%"
          />
          <div class="form-tip">Aria2 RPC 服务端口（默认：6800）</div>
        </el-form-item>

        <el-form-item label="路径" prop="path">
          <el-input
            v-model="form.path"
            placeholder="/jsonrpc"
          />
          <div class="form-tip">RPC 接口路径（默认：/jsonrpc）</div>
        </el-form-item>

        <el-form-item label="密钥" prop="secret">
          <el-input
            v-model="form.secret"
            type="password"
            placeholder="可选，RPC 访问密钥"
            show-password
            clearable
          />
          <div class="form-tip">如果 Aria2 设置了 RPC 密钥，请在此输入</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">连接选项</span>
        </template>

        <el-form-item label="连接超时">
          <el-input-number
            v-model="connectionTimeout"
            :min="1000"
            :max="30000"
            :step="1000"
            style="width: 200px"
          />
          <span style="margin-left: 8px">毫秒</span>
          <div class="form-tip">连接超时时间（1000-30000毫秒）</div>
        </el-form-item>

        <el-form-item label="自动重连">
          <el-switch v-model="autoReconnect" />
          <div class="form-tip">连接断开时自动尝试重新连接</div>
        </el-form-item>

        <el-form-item label="重连间隔" v-if="autoReconnect">
          <el-input-number
            v-model="reconnectInterval"
            :min="1000"
            :max="60000"
            :step="1000"
            style="width: 200px"
          />
          <span style="margin-left: 8px">毫秒</span>
          <div class="form-tip">自动重连的时间间隔</div>
        </el-form-item>
      </el-card>

      <el-form-item style="margin-top: 24px">
        <el-space>
          <el-button
            type="primary"
            @click="testConnection"
            :loading="testing"
          >
            测试连接
          </el-button>
          <el-button
            type="success"
            @click="saveAndConnect"
            :loading="connecting"
          >
            保存并连接
          </el-button>
          <el-button @click="saveSettings">
            仅保存
          </el-button>
          <el-button @click="resetForm">
            重置
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>

    <!-- 连接测试结果 -->
    <el-card v-if="testResult" class="test-result" style="margin-top: 20px; max-width: 600px">
      <template #header>
        <span>连接测试结果</span>
      </template>

      <div class="test-info">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="连接状态">
            <el-tag :type="testResult.success ? 'success' : 'danger'">
              {{ testResult.success ? '成功' : '失败' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="响应时间" v-if="testResult.success">
            {{ testResult.responseTime }}ms
          </el-descriptions-item>
          <el-descriptions-item label="Aria2 版本" v-if="testResult.version">
            {{ testResult.version }}
          </el-descriptions-item>
          <el-descriptions-item label="支持功能" v-if="testResult.features">
            <el-tag
              v-for="feature in testResult.features"
              :key="feature"
              size="small"
              style="margin: 2px;"
            >
              {{ feature }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="错误信息" v-if="!testResult.success && testResult.error">
            <span style="color: #f56c6c">{{ testResult.error }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAria2Store } from '@/stores/aria2Store'
import { useSettingsStore } from '@/stores/settingsStore'
import { Aria2Service } from '@/services/aria2Service'

const aria2Store = useAria2Store()
const settingsStore = useSettingsStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const testing = ref(false)
const connecting = ref(false)

// 表单数据
const form = reactive({
  protocol: 'http' as 'http' | 'https' | 'ws' | 'wss',
  host: 'localhost',
  port: 6800,
  path: '/jsonrpc',
  secret: ''
})

// 连接选项
const connectionTimeout = ref(10000)
const autoReconnect = ref(true)
const reconnectInterval = ref(5000)

// 测试结果
const testResult = ref<{
  success: boolean
  responseTime?: number
  version?: string
  features?: string[]
  error?: string
} | null>(null)

// 表单验证规则
const rules: FormRules = {
  host: [
    { required: true, message: '请输入主机地址', trigger: 'blur' }
  ],
  port: [
    { required: true, message: '请输入端口号', trigger: 'blur' },
    { type: 'number', min: 1, max: 65535, message: '端口号必须在1-65535之间', trigger: 'blur' }
  ],
  path: [
    { required: true, message: '请输入路径', trigger: 'blur' }
  ]
}

// 连接状态
const connectionStatus = computed(() => {
  if (aria2Store.isConnecting) {
    return { type: 'warning', text: '连接中...' }
  } else if (aria2Store.isConnected) {
    return { type: 'success', text: '已连接' }
  } else {
    return { type: 'danger', text: '未连接' }
  }
})

onMounted(async () => {
  await settingsStore.initialize()
  const config = settingsStore.aria2Config
  Object.assign(form, config)
})

async function testConnection() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  testing.value = true
  testResult.value = null

  const startTime = Date.now()

  try {
    // 创建临时服务实例进行测试
    const testService = new Aria2Service(form)

    // 测试连接并获取版本信息
    const version = await testService.getVersion()
    const responseTime = Date.now() - startTime

    testResult.value = {
      success: true,
      responseTime,
      version: version.version,
      features: version.enabledFeatures
    }

    ElMessage.success('连接测试成功')
  } catch (error) {
    testResult.value = {
      success: false,
      error: error instanceof Error ? error.message : '连接失败'
    }

    ElMessage.error('连接测试失败')
  } finally {
    testing.value = false
  }
}

async function saveSettings() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
    await settingsStore.updateAria2Config(form)
    ElMessage.success('设置已保存')
  } catch (error) {
    if (error !== false) { // 不是验证失败
      ElMessage.error('保存设置失败')
    }
  }
}

async function saveAndConnect() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  connecting.value = true

  try {
    // 保存设置
    await settingsStore.updateAria2Config(form)

    // 连接到 Aria2
    await aria2Store.connect(form)

    ElMessage.success('连接成功')
  } catch (error) {
    ElMessage.error('连接失败：' + (error instanceof Error ? error.message : '未知错误'))
  } finally {
    connecting.value = false
  }
}

function resetForm() {
  const config = settingsStore.aria2Config
  Object.assign(form, config)
  testResult.value = null
  ElMessage.info('已重置为保存的设置')
}
</script>

<style scoped>
.rpc-settings {
  padding: 20px;
}

.settings-header {
  margin-bottom: 24px;
}

.settings-header h2 {
  margin: 0 0 8px 0;
  font-size: 20px;
  font-weight: 600;
}

.settings-description {
  margin: 0;
  color: #909399;
  font-size: 14px;
}

.setting-group {
  margin-bottom: 20px;
}

.connection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.group-title {
  font-weight: 600;
  color: #303133;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}

.test-result {
  animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

:deep(.el-card__header) {
  padding: 12px 20px;
  background-color: #fafafa;
}

:deep(.el-card__body) {
  padding: 20px;
}
</style>
