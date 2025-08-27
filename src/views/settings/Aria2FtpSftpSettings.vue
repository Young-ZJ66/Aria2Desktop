<template>
  <div class="ftp-settings">
    <div class="settings-header">
      <h2>FTP/SFTP 设置</h2>
      <p class="settings-description">配置 FTP 和 SFTP 协议相关参数</p>
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
          <span class="group-title">FTP 设置</span>
        </template>

        <el-form-item label="FTP 用户名">
          <el-input
            v-model="settings.ftpUser"
            placeholder="FTP 用户名"
          />
        </el-form-item>

        <el-form-item label="FTP 密码">
          <el-input
            v-model="settings.ftpPasswd"
            type="password"
            placeholder="FTP 密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="FTP 代理">
          <el-input
            v-model="settings.ftpProxy"
            placeholder="ftp://proxy.example.com:21"
          />
        </el-form-item>

        <el-form-item label="FTP 代理用户名">
          <el-input
            v-model="settings.ftpProxyUser"
            placeholder="代理用户名"
          />
        </el-form-item>

        <el-form-item label="FTP 代理密码">
          <el-input
            v-model="settings.ftpProxyPasswd"
            type="password"
            placeholder="代理密码"
            show-password
          />
        </el-form-item>

        <el-form-item label="FTP 类型">
          <el-select v-model="settings.ftpType" style="width: 200px">
            <el-option label="二进制" value="binary" />
            <el-option label="ASCII" value="ascii" />
          </el-select>
        </el-form-item>

        <el-form-item label="被动模式">
          <el-switch v-model="settings.ftpPasv" />
          <div class="form-tip">使用 FTP 被动模式</div>
        </el-form-item>

        <el-form-item label="重用连接">
          <el-switch v-model="settings.ftpReuseConnection" />
          <div class="form-tip">重用 FTP 连接</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">SFTP 设置</span>
        </template>

        <el-form-item label="SSH 主机密钥文件">
          <el-input
            v-model="settings.sshHostKeyMd"
            placeholder="SSH 主机密钥文件路径"
          />
        </el-form-item>

        <el-form-item label="SFTP 连接超时">
          <el-input-number
            v-model="settings.connectTimeout"
            :min="1"
            :max="600"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
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

const settings = reactive({
  ftpUser: '',
  ftpPasswd: '',
  ftpProxy: '',
  ftpProxyUser: '',
  ftpProxyPasswd: '',
  ftpType: 'binary',
  ftpPasv: true,
  ftpReuseConnection: true,
  sshHostKeyMd: '',
  connectTimeout: 60
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
      settings.ftpUser = options['ftp-user'] || ''
      settings.ftpPasswd = options['ftp-passwd'] || ''
      settings.ftpProxy = options['ftp-proxy'] || ''
      settings.ftpProxyUser = options['ftp-proxy-user'] || ''
      settings.ftpProxyPasswd = options['ftp-proxy-passwd'] || ''
      settings.ftpType = options['ftp-type'] || 'binary'
      settings.ftpPasv = options['ftp-pasv'] !== 'false'
      settings.ftpReuseConnection = options['ftp-reuse-connection'] !== 'false'
      settings.sshHostKeyMd = options['ssh-host-key-md'] || ''
      settings.connectTimeout = parseInt(options['connect-timeout'] || '60')
    }
    ElMessage.success('设置加载成功')
  } catch (error) {
    ElMessage.error('加载设置失败')
    console.error('Failed to load FTP settings:', error)
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
      'ftp-type': settings.ftpType,
      'ftp-pasv': settings.ftpPasv ? 'true' : 'false',
      'ftp-reuse-connection': settings.ftpReuseConnection ? 'true' : 'false',
      'connect-timeout': settings.connectTimeout.toString()
    }

    if (settings.ftpUser) options['ftp-user'] = settings.ftpUser
    if (settings.ftpPasswd) options['ftp-passwd'] = settings.ftpPasswd
    if (settings.ftpProxy) options['ftp-proxy'] = settings.ftpProxy
    if (settings.ftpProxyUser) options['ftp-proxy-user'] = settings.ftpProxyUser
    if (settings.ftpProxyPasswd) options['ftp-proxy-passwd'] = settings.ftpProxyPasswd
    if (settings.sshHostKeyMd) options['ssh-host-key-md'] = settings.sshHostKeyMd

    await aria2Store.changeGlobalOptions(options)
    ElMessage.success('设置保存成功')
  } catch (error) {
    ElMessage.error('保存设置失败')
    console.error('Failed to save FTP settings:', error)
  } finally {
    saving.value = false
  }
}

function resetSettings() {
  settings.ftpUser = ''
  settings.ftpPasswd = ''
  settings.ftpProxy = ''
  settings.ftpProxyUser = ''
  settings.ftpProxyPasswd = ''
  settings.ftpType = 'binary'
  settings.ftpPasv = true
  settings.ftpReuseConnection = true
  settings.sshHostKeyMd = ''
  settings.connectTimeout = 60

  ElMessage.info('已重置为默认值')
}
</script>

<style scoped>
.ftp-settings {
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
