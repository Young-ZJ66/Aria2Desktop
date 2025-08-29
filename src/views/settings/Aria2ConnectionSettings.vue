<template>
  <div class="connection-settings">
    <div class="settings-header">
      <h2>连接设置</h2>
      <p class="settings-description">配置连接、超时、重试和代理相关参数</p>
    </div>

    <el-alert
      v-if="!aria2Store.isConnected"
      title="未连接到 Aria2 服务器"
      description="请先连接到 Aria2 服务器才能修改设置"
      type="warning"
      :closable="false"
      style="margin-bottom: 20px"
    />

    <el-form
      ref="formRef"
      :model="settings"
      :rules="rules"
      label-width="200px"
      style="max-width: 800px"
      v-loading="loading"
      :disabled="!aria2Store.isConnected"
    >
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">超时设置</span>
        </template>

        <el-form-item label="连接超时" prop="connectTimeout">
          <el-input-number
            v-model="settings.connectTimeout"
            :min="1"
            :max="600"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">建立连接的超时时间（1-600秒）</div>
        </el-form-item>

        <el-form-item label="请求超时" prop="timeout">
          <el-input-number
            v-model="settings.timeout"
            :min="1"
            :max="600"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">HTTP/FTP 请求的超时时间（1-600秒）</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">重试设置</span>
        </template>

        <el-form-item label="最大重试次数" prop="maxTries">
          <el-input-number
            v-model="settings.maxTries"
            :min="0"
            :max="100"
            style="width: 200px"
          />
          <div class="form-tip">连接失败时的最大重试次数（0表示不重试）</div>
        </el-form-item>

        <el-form-item label="重试等待时间" prop="retryWait">
          <el-input-number
            v-model="settings.retryWait"
            :min="0"
            :max="600"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">重试前的等待时间（0-600秒）</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">连接数限制</span>
        </template>

        <el-form-item label="每服务器最大连接数" prop="maxConnectionPerServer">
          <el-input-number
            v-model="settings.maxConnectionPerServer"
            :min="1"
            :max="16"
            style="width: 200px"
          />
          <div class="form-tip">对单个服务器的最大连接数（1-16）</div>
        </el-form-item>

        <el-form-item label="分片连接数" prop="split">
          <el-input-number
            v-model="settings.split"
            :min="1"
            :max="16"
            style="width: 200px"
          />
          <div class="form-tip">每个文件的分片连接数（1-16）</div>
        </el-form-item>

        <el-form-item label="最低下载速度" prop="lowestSpeedLimit">
          <el-input
            v-model="settings.lowestSpeedLimit"
            placeholder="0 表示无限制"
            style="width: 200px"
          />
          <span style="margin-left: 8px">B/s</span>
          <div class="form-tip">最低下载速度限制，低于此速度将重连</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">通用代理设置</span>
        </template>

        <el-form-item label="全局代理">
          <el-input
            v-model="settings.allProxy"
            placeholder="http://proxy.example.com:8080"
          />
          <div class="form-tip">适用于所有协议的通用代理服务器</div>
        </el-form-item>

        <el-form-item label="代理用户名">
          <el-input
            v-model="settings.allProxyUser"
            placeholder="代理服务器用户名"
          />
        </el-form-item>

        <el-form-item label="代理密码">
          <el-input
            v-model="settings.allProxyPasswd"
            type="password"
            placeholder="代理服务器密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="无代理主机">
          <el-input
            v-model="settings.noProxy"
            placeholder="localhost,127.0.0.1,*.local"
          />
          <div class="form-tip">不使用代理的主机列表，用逗号分隔</div>
        </el-form-item>
      </el-card>

      <el-form-item style="margin-top: 24px">
        <el-space>
          <el-button
            type="primary"
            @click="saveSettings"
            :loading="saving"
            :disabled="!aria2Store.isConnected"
          >
            保存设置
          </el-button>
          <el-button
            @click="loadSettings"
            :disabled="!aria2Store.isConnected"
          >
            重新加载
          </el-button>
          <el-button
            @click="resetToDefaults"
            :disabled="!aria2Store.isConnected"
          >
            恢复默认
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useAria2Store } from '@/stores/aria2Store'

const aria2Store = useAria2Store()
const formRef = ref<FormInstance>()
const loading = ref(false)
const saving = ref(false)

// 表单数据
const settings = reactive({
  connectTimeout: 60,
  timeout: 60,
  maxTries: 5,
  retryWait: 0,
  maxConnectionPerServer: 5,
  split: 5,
  lowestSpeedLimit: '0',
  allProxy: '',
  allProxyUser: '',
  allProxyPasswd: '',
  noProxy: ''
})

// 表单验证规则
const rules: FormRules = {
  connectTimeout: [
    { type: 'number', min: 1, max: 600, message: '值必须在1-600之间', trigger: 'blur' }
  ],
  timeout: [
    { type: 'number', min: 1, max: 600, message: '值必须在1-600之间', trigger: 'blur' }
  ],
  maxTries: [
    { type: 'number', min: 0, max: 100, message: '值必须在0-100之间', trigger: 'blur' }
  ],
  retryWait: [
    { type: 'number', min: 0, max: 600, message: '值必须在0-600之间', trigger: 'blur' }
  ],
  maxConnectionPerServer: [
    { type: 'number', min: 1, max: 16, message: '值必须在1-16之间', trigger: 'blur' }
  ],
  split: [
    { type: 'number', min: 1, max: 16, message: '值必须在1-16之间', trigger: 'blur' }
  ]
}

onMounted(() => {
  if (aria2Store.isConnected) {
    loadSettings()
  }
})

async function loadSettings() {
  if (!aria2Store.isConnected) {
    ElMessage.warning('请先连接到 Aria2 服务器')
    return
  }

  loading.value = true
  try {
    const options = await aria2Store.getGlobalOptions()
    
    if (options && typeof options === 'object') {
      settings.connectTimeout = parseInt(options['connect-timeout'] || '60')
      settings.timeout = parseInt(options['timeout'] || '60')
      settings.maxTries = parseInt(options['max-tries'] || '5')
      settings.retryWait = parseInt(options['retry-wait'] || '0')
      settings.maxConnectionPerServer = parseInt(options['max-connection-per-server'] || '5')
      settings.split = parseInt(options['split'] || '5')
      settings.lowestSpeedLimit = options['lowest-speed-limit'] || '0'
      settings.allProxy = options['all-proxy'] || ''
      settings.allProxyUser = options['all-proxy-user'] || ''
      settings.allProxyPasswd = options['all-proxy-passwd'] || ''
      settings.noProxy = options['no-proxy'] || ''

      ElMessage.success('连接设置加载成功')
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    ElMessage.error(`加载连接设置失败: ${errorMessage}`)
    console.error('Failed to load connection settings:', error)
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  if (!aria2Store.isConnected) {
    ElMessage.warning('请先连接到 Aria2 服务器')
    return
  }

  saving.value = true
  try {
    const options = {
      'connect-timeout': settings.connectTimeout.toString(),
      'timeout': settings.timeout.toString(),
      'max-tries': settings.maxTries.toString(),
      'retry-wait': settings.retryWait.toString(),
      'max-connection-per-server': settings.maxConnectionPerServer.toString(),
      'split': settings.split.toString(),
      'lowest-speed-limit': settings.lowestSpeedLimit
    }

    // 可选的代理设置
    if (settings.allProxy) options['all-proxy'] = settings.allProxy
    if (settings.allProxyUser) options['all-proxy-user'] = settings.allProxyUser
    if (settings.allProxyPasswd) options['all-proxy-passwd'] = settings.allProxyPasswd
    if (settings.noProxy) options['no-proxy'] = settings.noProxy

    await aria2Store.changeGlobalOptions(options)
    ElMessage.success('连接设置已保存')
  } catch (error) {
    ElMessage.error('保存连接设置失败')
    console.error('Failed to save connection settings:', error)
  } finally {
    saving.value = false
  }
}

async function resetToDefaults() {
  try {
    await ElMessageBox.confirm(
      '确定要恢复为默认连接设置吗？',
      '确认恢复',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // 恢复默认值
    Object.assign(settings, {
      connectTimeout: 60,
      timeout: 60,
      maxTries: 5,
      retryWait: 0,
      maxConnectionPerServer: 5,
      split: 5,
      lowestSpeedLimit: '0',
      allProxy: '',
      allProxyUser: '',
      allProxyPasswd: '',
      noProxy: ''
    })

    ElMessage.success('已恢复为默认连接设置')
  } catch (error) {
    // 用户取消
  }
}
</script>

<style scoped>
.connection-settings {
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
  color: var(--text-secondary);
  font-size: 14px;
}

.setting-group {
  margin-bottom: 20px;
}

.group-title {
  font-weight: 600;
  color: var(--text-primary);
}

.form-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

:deep(.el-card__header) {
  padding: 12px 20px;
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-light);
}

:deep(.el-card__body) {
  padding: 20px;
  background-color: var(--bg-secondary);
}
</style>
