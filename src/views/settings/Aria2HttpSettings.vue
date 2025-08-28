<template>
  <div class="http-settings">
    <div class="settings-header">
      <h2>HTTP/HTTPS 设置</h2>
      <p class="settings-description">配置 HTTP 和 HTTPS 下载相关参数</p>
    </div>

    <el-form
      ref="formRef"
      :model="settings"
      label-width="200px"
      style="max-width: 800px"
      v-loading="loading"
    >
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">连接设置</span>
        </template>

        <el-form-item label="用户代理">
          <el-input
            v-model="settings.userAgent"
            placeholder="默认用户代理字符串"
          />
          <div class="form-tip">设置 HTTP 请求的 User-Agent 头</div>
        </el-form-item>

        <el-form-item label="HTTP 代理">
          <el-input
            v-model="settings.httpProxy"
            placeholder="http://proxy.example.com:8080"
          />
          <div class="form-tip">HTTP 代理服务器地址</div>
        </el-form-item>

        <el-form-item label="HTTPS 代理">
          <el-input
            v-model="settings.httpsProxy"
            placeholder="https://proxy.example.com:8080"
          />
          <div class="form-tip">HTTPS 代理服务器地址</div>
        </el-form-item>

        <el-form-item label="代理用户名">
          <el-input
            v-model="settings.httpProxyUser"
            placeholder="代理服务器用户名"
          />
        </el-form-item>

        <el-form-item label="代理密码">
          <el-input
            v-model="settings.httpProxyPasswd"
            type="password"
            placeholder="代理服务器密码"
            show-password
          />
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">认证设置</span>
        </template>

        <el-form-item label="HTTP 用户名">
          <el-input
            v-model="settings.httpUser"
            placeholder="HTTP 基本认证用户名"
          />
        </el-form-item>

        <el-form-item label="HTTP 密码">
          <el-input
            v-model="settings.httpPasswd"
            type="password"
            placeholder="HTTP 基本认证密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="接受所有证书">
          <el-switch v-model="settings.checkCertificate" />
          <div class="form-tip">是否验证 HTTPS 证书</div>
        </el-form-item>

        <el-form-item label="CA 证书文件">
          <el-input
            v-model="settings.caCertificate"
            placeholder="CA 证书文件路径"
          />
          <div class="form-tip">用于验证 HTTPS 证书的 CA 证书文件</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">请求设置</span>
        </template>

        <el-form-item label="请求头">
          <el-input
            v-model="settings.header"
            type="textarea"
            :rows="4"
            placeholder="自定义 HTTP 请求头，每行一个，格式：Header: Value"
          />
          <div class="form-tip">自定义 HTTP 请求头，每行一个</div>
        </el-form-item>

        <el-form-item label="Cookie">
          <el-input
            v-model="settings.cookie"
            placeholder="HTTP Cookie 字符串"
          />
          <div class="form-tip">发送给服务器的 Cookie</div>
        </el-form-item>

        <el-form-item label="Referer">
          <el-input
            v-model="settings.referer"
            placeholder="HTTP Referer 头"
          />
          <div class="form-tip">HTTP Referer 头的值</div>
        </el-form-item>

        <el-form-item label="连接超时">
          <el-input-number
            v-model="settings.connectTimeout"
            :min="1"
            :max="600"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">建立连接的超时时间</div>
        </el-form-item>

        <el-form-item label="请求超时">
          <el-input-number
            v-model="settings.timeout"
            :min="1"
            :max="600"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">HTTP 请求的超时时间</div>
        </el-form-item>
      </el-card>

      <el-form-item style="margin-top: 24px">
        <el-space>
          <el-button
            type="primary"
            @click="saveSettings"
            :disabled="!aria2Store.isConnected"
            :loading="saving"
          >
            保存设置
          </el-button>
          <el-button
            @click="loadSettings"
            :disabled="!aria2Store.isConnected"
          >
            重新加载
          </el-button>
          <el-button @click="resetSettings">
            重置为默认值
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, type FormInstance } from 'element-plus'
import { useAria2Store } from '@/stores/aria2Store'

const aria2Store = useAria2Store()
const formRef = ref<FormInstance>()
const loading = ref(false)
const saving = ref(false)

// HTTP 设置
const settings = reactive({
  userAgent: '',
  httpProxy: '',
  httpsProxy: '',
  httpProxyUser: '',
  httpProxyPasswd: '',
  httpUser: '',
  httpPasswd: '',
  checkCertificate: true,
  caCertificate: '',
  header: '',
  cookie: '',
  referer: '',
  connectTimeout: 60,
  timeout: 60
})

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
    if (options) {
      settings.userAgent = options['user-agent'] || ''
      settings.httpProxy = options['http-proxy'] || ''
      settings.httpsProxy = options['https-proxy'] || ''
      settings.httpProxyUser = options['http-proxy-user'] || ''
      settings.httpProxyPasswd = options['http-proxy-passwd'] || ''
      settings.httpUser = options['http-user'] || ''
      settings.httpPasswd = options['http-passwd'] || ''
      settings.checkCertificate = options['check-certificate'] !== 'false'
      settings.caCertificate = options['ca-certificate'] || ''
      settings.header = options['header'] || ''
      settings.cookie = options['cookie'] || ''
      settings.referer = options['referer'] || ''
      settings.connectTimeout = parseInt(options['connect-timeout'] || '60')
      settings.timeout = parseInt(options['timeout'] || '60')
    }
    ElMessage.success('设置加载成功')
  } catch (error) {
    ElMessage.error('加载设置失败')
    console.error('Failed to load HTTP settings:', error)
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (!aria2Store.isConnected) {
    ElMessage.warning('请先连接到 Aria2 服务器')
    return
  }

  saving.value = true
  try {
    const options: Record<string, string> = {}

    if (settings.userAgent) options['user-agent'] = settings.userAgent
    if (settings.httpProxy) options['http-proxy'] = settings.httpProxy
    if (settings.httpsProxy) options['https-proxy'] = settings.httpsProxy
    if (settings.httpProxyUser) options['http-proxy-user'] = settings.httpProxyUser
    if (settings.httpProxyPasswd) options['http-proxy-passwd'] = settings.httpProxyPasswd
    if (settings.httpUser) options['http-user'] = settings.httpUser
    if (settings.httpPasswd) options['http-passwd'] = settings.httpPasswd
    options['check-certificate'] = settings.checkCertificate ? 'true' : 'false'
    if (settings.caCertificate) options['ca-certificate'] = settings.caCertificate
    if (settings.header) options['header'] = settings.header
    if (settings.cookie) options['cookie'] = settings.cookie
    if (settings.referer) options['referer'] = settings.referer
    options['connect-timeout'] = settings.connectTimeout.toString()
    options['timeout'] = settings.timeout.toString()

    await aria2Store.changeGlobalOptions(options)
    ElMessage.success('设置保存成功')
  } catch (error) {
    ElMessage.error('保存设置失败')
    console.error('Failed to save HTTP settings:', error)
  } finally {
    saving.value = false
  }
}

function resetSettings() {
  settings.userAgent = ''
  settings.httpProxy = ''
  settings.httpsProxy = ''
  settings.httpProxyUser = ''
  settings.httpProxyPasswd = ''
  settings.httpUser = ''
  settings.httpPasswd = ''
  settings.checkCertificate = true
  settings.caCertificate = ''
  settings.header = ''
  settings.cookie = ''
  settings.referer = ''
  settings.connectTimeout = 60
  settings.timeout = 60

  ElMessage.info('已重置为默认值')
}
</script>

<style scoped>
.http-settings {
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

/* 使用全局 .form-tip 样式 */

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
