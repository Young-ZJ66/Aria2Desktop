<template>
  <div class="http-ftp-sftp-settings">
    <div class="settings-header">
      <h2>HTTP/FTP/SFTP 设置</h2>
      <p class="settings-description">配置 HTTP、FTP 和 SFTP 协议的综合参数</p>
    </div>

    <el-form
      ref="formRef"
      :model="settings"
      label-width="200px"
      style="max-width: 800px"
      v-loading="loading"
    >
      <!-- HTTP 设置 -->
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">HTTP/HTTPS 设置</span>
        </template>

        <el-form-item label="用户代理">
          <el-input
            v-model="settings.userAgent"
            placeholder="自定义 User-Agent"
          />
          <div class="form-tip">HTTP 请求的 User-Agent 头</div>
        </el-form-item>

        <el-form-item label="HTTP 认证用户名">
          <el-input
            v-model="settings.httpUser"
            placeholder="HTTP 基本认证用户名"
          />
        </el-form-item>

        <el-form-item label="HTTP 认证密码">
          <el-input
            v-model="settings.httpPasswd"
            type="password"
            placeholder="HTTP 基本认证密码"
            show-password
          />
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

        <el-form-item label="代理认证用户名">
          <el-input
            v-model="settings.httpProxyUser"
            placeholder="代理服务器用户名"
          />
        </el-form-item>

        <el-form-item label="代理认证密码">
          <el-input
            v-model="settings.httpProxyPasswd"
            type="password"
            placeholder="代理服务器密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="自定义请求头">
          <el-input
            v-model="settings.header"
            type="textarea"
            :rows="4"
            placeholder="自定义 HTTP 请求头，每行一个&#10;格式：Header-Name: Header-Value&#10;&#10;示例：&#10;Authorization: Bearer token123&#10;X-Custom-Header: custom-value"
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

        <el-form-item label="验证 HTTPS 证书">
          <el-switch v-model="settings.checkCertificate" />
          <div class="form-tip">是否验证 HTTPS 服务器证书</div>
        </el-form-item>

        <el-form-item label="CA 证书文件">
          <el-input
            v-model="settings.caCertificate"
            placeholder="CA 证书文件路径"
          />
          <div class="form-tip">用于验证 HTTPS 证书的 CA 证书文件</div>
        </el-form-item>

        <el-form-item label="客户端证书">
          <el-input
            v-model="settings.certificate"
            placeholder="客户端证书文件路径"
          />
          <div class="form-tip">HTTPS 客户端证书文件</div>
        </el-form-item>

        <el-form-item label="私钥文件">
          <el-input
            v-model="settings.privateKey"
            placeholder="私钥文件路径"
          />
          <div class="form-tip">客户端证书的私钥文件</div>
        </el-form-item>
      </el-card>

      <!-- FTP 设置 -->
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">FTP 设置</span>
        </template>

        <el-form-item label="FTP 用户名">
          <el-input
            v-model="settings.ftpUser"
            placeholder="FTP 登录用户名"
          />
        </el-form-item>

        <el-form-item label="FTP 密码">
          <el-input
            v-model="settings.ftpPasswd"
            type="password"
            placeholder="FTP 登录密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="FTP 代理">
          <el-input
            v-model="settings.ftpProxy"
            placeholder="ftp://proxy.example.com:21"
          />
          <div class="form-tip">FTP 代理服务器地址</div>
        </el-form-item>

        <el-form-item label="FTP 代理用户名">
          <el-input
            v-model="settings.ftpProxyUser"
            placeholder="FTP 代理用户名"
          />
        </el-form-item>

        <el-form-item label="FTP 代理密码">
          <el-input
            v-model="settings.ftpProxyPasswd"
            type="password"
            placeholder="FTP 代理密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="FTP 传输类型">
          <el-select v-model="settings.ftpType" style="width: 200px">
            <el-option label="二进制模式" value="binary" />
            <el-option label="ASCII 模式" value="ascii" />
          </el-select>
          <div class="form-tip">FTP 文件传输模式</div>
        </el-form-item>

        <el-form-item label="被动模式">
          <el-switch v-model="settings.ftpPasv" />
          <div class="form-tip">使用 FTP 被动模式（推荐）</div>
        </el-form-item>

        <el-form-item label="重用连接">
          <el-switch v-model="settings.ftpReuseConnection" />
          <div class="form-tip">重用 FTP 连接以提高性能</div>
        </el-form-item>
      </el-card>

      <!-- SFTP 设置 -->
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">SFTP/SSH 设置</span>
        </template>

        <el-form-item label="SSH 主机密钥文件">
          <el-input
            v-model="settings.sshHostKeyMd"
            placeholder="SSH 主机密钥文件路径"
          />
          <div class="form-tip">SSH 主机密钥验证文件</div>
        </el-form-item>

        <el-form-item label="SSH 私钥文件">
          <el-input
            v-model="settings.sshPrivateKey"
            placeholder="SSH 私钥文件路径"
          />
          <div class="form-tip">SSH 私钥文件用于身份验证</div>
        </el-form-item>

        <el-form-item label="SSH 公钥文件">
          <el-input
            v-model="settings.sshPublicKey"
            placeholder="SSH 公钥文件路径"
          />
          <div class="form-tip">SSH 公钥文件</div>
        </el-form-item>

        <el-form-item label="SSH 密钥密码">
          <el-input
            v-model="settings.sshKeyPassphrase"
            type="password"
            placeholder="SSH 私钥密码"
            show-password
          />
          <div class="form-tip">SSH 私钥文件的密码</div>
        </el-form-item>
      </el-card>

      <!-- 通用连接设置 -->
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">连接设置</span>
        </template>

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
          <div class="form-tip">HTTP/FTP 请求的超时时间</div>
        </el-form-item>

        <el-form-item label="最大重试次数">
          <el-input-number
            v-model="settings.maxTries"
            :min="0"
            :max="100"
            style="width: 200px"
          />
          <div class="form-tip">连接失败时的最大重试次数</div>
        </el-form-item>

        <el-form-item label="重试等待时间">
          <el-input-number
            v-model="settings.retryWait"
            :min="0"
            :max="600"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">重试前的等待时间</div>
        </el-form-item>

        <el-form-item label="最低下载速度">
          <el-input
            v-model="settings.lowestSpeedLimit"
            placeholder="0 表示无限制"
            style="width: 200px"
          />
          <span style="margin-left: 8px">B/s</span>
          <div class="form-tip">最低下载速度限制，低于此速度将重连</div>
        </el-form-item>

        <el-form-item label="分片大小">
          <el-select v-model="settings.minSplitSize" style="width: 200px">
            <el-option label="1M" value="1M" />
            <el-option label="5M" value="5M" />
            <el-option label="10M" value="10M" />
            <el-option label="20M" value="20M" />
            <el-option label="50M" value="50M" />
            <el-option label="100M" value="100M" />
          </el-select>
          <div class="form-tip">文件分片的最小大小</div>
        </el-form-item>

        <el-form-item label="最大连接数">
          <el-input-number
            v-model="settings.maxConnectionPerServer"
            :min="1"
            :max="16"
            style="width: 200px"
          />
          <div class="form-tip">每个服务器的最大连接数</div>
        </el-form-item>

        <el-form-item label="分片连接数">
          <el-input-number
            v-model="settings.split"
            :min="1"
            :max="16"
            style="width: 200px"
          />
          <div class="form-tip">每个文件的分片连接数</div>
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

// HTTP/FTP/SFTP 综合设置
const settings = reactive({
  // HTTP 设置
  userAgent: '',
  httpUser: '',
  httpPasswd: '',
  httpProxy: '',
  httpsProxy: '',
  httpProxyUser: '',
  httpProxyPasswd: '',
  header: '',
  cookie: '',
  referer: '',
  checkCertificate: true,
  caCertificate: '',
  certificate: '',
  privateKey: '',

  // FTP 设置
  ftpUser: '',
  ftpPasswd: '',
  ftpProxy: '',
  ftpProxyUser: '',
  ftpProxyPasswd: '',
  ftpType: 'binary',
  ftpPasv: true,
  ftpReuseConnection: true,

  // SFTP/SSH 设置
  sshHostKeyMd: '',
  sshPrivateKey: '',
  sshPublicKey: '',
  sshKeyPassphrase: '',

  // 通用连接设置
  connectTimeout: 60,
  timeout: 60,
  maxTries: 5,
  retryWait: 0,
  lowestSpeedLimit: '0',
  minSplitSize: '20M',
  maxConnectionPerServer: 1,
  split: 5
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
      // HTTP 设置
      settings.userAgent = options['user-agent'] || ''
      settings.httpUser = options['http-user'] || ''
      settings.httpPasswd = options['http-passwd'] || ''
      settings.httpProxy = options['http-proxy'] || ''
      settings.httpsProxy = options['https-proxy'] || ''
      settings.httpProxyUser = options['http-proxy-user'] || ''
      settings.httpProxyPasswd = options['http-proxy-passwd'] || ''
      settings.header = options['header'] || ''
      settings.cookie = options['cookie'] || ''
      settings.referer = options['referer'] || ''
      settings.checkCertificate = options['check-certificate'] !== 'false'
      settings.caCertificate = options['ca-certificate'] || ''
      settings.certificate = options['certificate'] || ''
      settings.privateKey = options['private-key'] || ''

      // FTP 设置
      settings.ftpUser = options['ftp-user'] || ''
      settings.ftpPasswd = options['ftp-passwd'] || ''
      settings.ftpProxy = options['ftp-proxy'] || ''
      settings.ftpProxyUser = options['ftp-proxy-user'] || ''
      settings.ftpProxyPasswd = options['ftp-proxy-passwd'] || ''
      settings.ftpType = options['ftp-type'] || 'binary'
      settings.ftpPasv = options['ftp-pasv'] !== 'false'
      settings.ftpReuseConnection = options['ftp-reuse-connection'] !== 'false'

      // SFTP/SSH 设置
      settings.sshHostKeyMd = options['ssh-host-key-md'] || ''
      settings.sshPrivateKey = options['ssh-private-key'] || ''
      settings.sshPublicKey = options['ssh-public-key'] || ''
      settings.sshKeyPassphrase = options['ssh-key-passphrase'] || ''

      // 通用连接设置
      settings.connectTimeout = parseInt(options['connect-timeout'] || '60')
      settings.timeout = parseInt(options['timeout'] || '60')
      settings.maxTries = parseInt(options['max-tries'] || '5')
      settings.retryWait = parseInt(options['retry-wait'] || '0')
      settings.lowestSpeedLimit = options['lowest-speed-limit'] || '0'
      settings.minSplitSize = options['min-split-size'] || '20M'
      settings.maxConnectionPerServer = parseInt(options['max-connection-per-server'] || '1')
      settings.split = parseInt(options['split'] || '5')
    }
    ElMessage.success('设置加载成功')
  } catch (error) {
    ElMessage.error('加载设置失败')
    console.error('Failed to load HTTP/FTP/SFTP settings:', error)
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
    const options: Record<string, string> = {
      // HTTP 设置
      'check-certificate': settings.checkCertificate ? 'true' : 'false',

      // FTP 设置
      'ftp-type': settings.ftpType,
      'ftp-pasv': settings.ftpPasv ? 'true' : 'false',
      'ftp-reuse-connection': settings.ftpReuseConnection ? 'true' : 'false',

      // 通用连接设置
      'connect-timeout': settings.connectTimeout.toString(),
      'timeout': settings.timeout.toString(),
      'max-tries': settings.maxTries.toString(),
      'retry-wait': settings.retryWait.toString(),
      'lowest-speed-limit': settings.lowestSpeedLimit,
      'min-split-size': settings.minSplitSize,
      'max-connection-per-server': settings.maxConnectionPerServer.toString(),
      'split': settings.split.toString()
    }

    // 可选的字符串设置
    if (settings.userAgent) options['user-agent'] = settings.userAgent
    if (settings.httpUser) options['http-user'] = settings.httpUser
    if (settings.httpPasswd) options['http-passwd'] = settings.httpPasswd
    if (settings.httpProxy) options['http-proxy'] = settings.httpProxy
    if (settings.httpsProxy) options['https-proxy'] = settings.httpsProxy
    if (settings.httpProxyUser) options['http-proxy-user'] = settings.httpProxyUser
    if (settings.httpProxyPasswd) options['http-proxy-passwd'] = settings.httpProxyPasswd
    if (settings.header) options['header'] = settings.header
    if (settings.cookie) options['cookie'] = settings.cookie
    if (settings.referer) options['referer'] = settings.referer
    if (settings.caCertificate) options['ca-certificate'] = settings.caCertificate
    if (settings.certificate) options['certificate'] = settings.certificate
    if (settings.privateKey) options['private-key'] = settings.privateKey

    if (settings.ftpUser) options['ftp-user'] = settings.ftpUser
    if (settings.ftpPasswd) options['ftp-passwd'] = settings.ftpPasswd
    if (settings.ftpProxy) options['ftp-proxy'] = settings.ftpProxy
    if (settings.ftpProxyUser) options['ftp-proxy-user'] = settings.ftpProxyUser
    if (settings.ftpProxyPasswd) options['ftp-proxy-passwd'] = settings.ftpProxyPasswd

    if (settings.sshHostKeyMd) options['ssh-host-key-md'] = settings.sshHostKeyMd
    if (settings.sshPrivateKey) options['ssh-private-key'] = settings.sshPrivateKey
    if (settings.sshPublicKey) options['ssh-public-key'] = settings.sshPublicKey
    if (settings.sshKeyPassphrase) options['ssh-key-passphrase'] = settings.sshKeyPassphrase

    await aria2Store.changeGlobalOptions(options)
    ElMessage.success('设置保存成功')
  } catch (error) {
    ElMessage.error('保存设置失败')
    console.error('Failed to save HTTP/FTP/SFTP settings:', error)
  } finally {
    saving.value = false
  }
}

function resetSettings() {
  // HTTP 设置
  settings.userAgent = ''
  settings.httpUser = ''
  settings.httpPasswd = ''
  settings.httpProxy = ''
  settings.httpsProxy = ''
  settings.httpProxyUser = ''
  settings.httpProxyPasswd = ''
  settings.header = ''
  settings.cookie = ''
  settings.referer = ''
  settings.checkCertificate = true
  settings.caCertificate = ''
  settings.certificate = ''
  settings.privateKey = ''

  // FTP 设置
  settings.ftpUser = ''
  settings.ftpPasswd = ''
  settings.ftpProxy = ''
  settings.ftpProxyUser = ''
  settings.ftpProxyPasswd = ''
  settings.ftpType = 'binary'
  settings.ftpPasv = true
  settings.ftpReuseConnection = true

  // SFTP/SSH 设置
  settings.sshHostKeyMd = ''
  settings.sshPrivateKey = ''
  settings.sshPublicKey = ''
  settings.sshKeyPassphrase = ''

  // 通用连接设置
  settings.connectTimeout = 60
  settings.timeout = 60
  settings.maxTries = 5
  settings.retryWait = 0
  settings.lowestSpeedLimit = '0'
  settings.minSplitSize = '20M'
  settings.maxConnectionPerServer = 1
  settings.split = 5

  ElMessage.info('已重置为默认值')
}
</script>

<style scoped>
.http-ftp-sftp-settings {
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

:deep(.el-card__header) {
  padding: 12px 20px;
  background-color: #fafafa;
}

:deep(.el-card__body) {
  padding: 20px;
}
</style>
