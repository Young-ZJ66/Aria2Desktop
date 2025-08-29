<template>
  <div class="security-settings">
    <div class="settings-header">
      <h2>安全与认证</h2>
      <p class="settings-description">配置 RPC 安全、文件安全和完整性检查参数</p>
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
      label-width="200px"
      style="max-width: 800px"
      v-loading="loading"
      :disabled="!aria2Store.isConnected"
    >
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">RPC 安全</span>
        </template>

        <el-form-item label="RPC 访问密钥">
          <el-input
            v-model="settings.rpcSecret"
            type="password"
            placeholder="RPC 接口访问密钥"
            show-password
            clearable
          />
          <div class="form-tip">设置 RPC 接口的访问密钥，留空表示不需要密钥</div>
        </el-form-item>

        <el-form-item label="RPC 监听所有接口">
          <el-switch v-model="settings.rpcListenAll" />
          <div class="form-tip">允许从所有网络接口访问 RPC</div>
        </el-form-item>

        <el-form-item label="启用 RPC 授权">
          <el-switch v-model="settings.enableRpcForAll" />
          <div class="form-tip">启用 RPC 接口的完整授权检查</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">文件安全</span>
        </template>

        <el-form-item label="允许覆盖文件">
          <el-switch v-model="settings.allowOverwrite" />
          <div class="form-tip">允许覆盖已存在的文件</div>
        </el-form-item>

        <el-form-item label="自动重命名文件">
          <el-switch v-model="settings.autoFileRenaming" />
          <div class="form-tip">当文件已存在时自动重命名新文件</div>
        </el-form-item>

        <el-form-item label="强制保存">
          <el-switch v-model="settings.forceSave" />
          <div class="form-tip">强制保存文件，即使校验失败</div>
        </el-form-item>

        <el-form-item label="文件权限" v-if="!isWindows">
          <el-input
            v-model="settings.fileAllocationMode"
            placeholder="644"
            style="width: 200px"
          />
          <div class="form-tip">新创建文件的权限模式（八进制）</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">完整性检查</span>
        </template>

        <el-form-item label="检查文件完整性">
          <el-switch v-model="settings.checkIntegrity" />
          <div class="form-tip">下载完成后检查文件完整性</div>
        </el-form-item>

        <el-form-item label="启用校验和检查">
          <el-switch v-model="settings.checksumCheck" />
          <div class="form-tip">启用文件校验和检查</div>
        </el-form-item>

        <el-form-item label="校验算法" prop="checksumAlgorithm">
          <el-select v-model="settings.checksumAlgorithm" style="width: 200px">
            <el-option label="SHA-1" value="sha-1" />
            <el-option label="SHA-224" value="sha-224" />
            <el-option label="SHA-256" value="sha-256" />
            <el-option label="SHA-384" value="sha-384" />
            <el-option label="SHA-512" value="sha-512" />
            <el-option label="MD5" value="md5" />
            <el-option label="ADLER32" value="adler32" />
          </el-select>
          <div class="form-tip">文件校验使用的摘要算法</div>
        </el-form-item>

        <el-form-item label="校验失败时继续">
          <el-switch v-model="settings.continueOnChecksumError" />
          <div class="form-tip">校验失败时是否继续下载</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">证书和加密</span>
        </template>

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
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus'
import { useAria2Store } from '@/stores/aria2Store'

const aria2Store = useAria2Store()
const formRef = ref<FormInstance>()
const loading = ref(false)
const saving = ref(false)

// 检测是否为 Windows 系统
const isWindows = computed(() => {
  return navigator.platform.toLowerCase().includes('win')
})

// 表单数据
const settings = reactive({
  rpcSecret: '',
  rpcListenAll: false,
  enableRpcForAll: false,
  allowOverwrite: false,
  autoFileRenaming: true,
  forceSave: false,
  fileAllocationMode: '644',
  checkIntegrity: false,
  checksumCheck: true,
  checksumAlgorithm: 'sha-1',
  continueOnChecksumError: false,
  checkCertificate: true,
  caCertificate: '',
  certificate: '',
  privateKey: ''
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
    
    if (options && typeof options === 'object') {
      settings.rpcSecret = options['rpc-secret'] || ''
      settings.rpcListenAll = options['rpc-listen-all'] === 'true'
      settings.enableRpcForAll = options['enable-rpc'] === 'true'
      settings.allowOverwrite = options['allow-overwrite'] === 'true'
      settings.autoFileRenaming = options['auto-file-renaming'] !== 'false'
      settings.forceSave = options['force-save'] === 'true'
      settings.fileAllocationMode = options['file-allocation-mode'] || '644'
      settings.checkIntegrity = options['check-integrity'] === 'true'
      settings.checksumCheck = options['checksum-check'] !== 'false'
      settings.checksumAlgorithm = options['checksum'] || 'sha-1'
      settings.continueOnChecksumError = options['continue-on-checksum-error'] === 'true'
      settings.checkCertificate = options['check-certificate'] !== 'false'
      settings.caCertificate = options['ca-certificate'] || ''
      settings.certificate = options['certificate'] || ''
      settings.privateKey = options['private-key'] || ''

      ElMessage.success('安全设置加载成功')
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    ElMessage.error(`加载安全设置失败: ${errorMessage}`)
    console.error('Failed to load security settings:', error)
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
      'rpc-listen-all': settings.rpcListenAll ? 'true' : 'false',
      'enable-rpc': settings.enableRpcForAll ? 'true' : 'false',
      'allow-overwrite': settings.allowOverwrite ? 'true' : 'false',
      'auto-file-renaming': settings.autoFileRenaming ? 'true' : 'false',
      'force-save': settings.forceSave ? 'true' : 'false',
      'check-integrity': settings.checkIntegrity ? 'true' : 'false',
      'checksum-check': settings.checksumCheck ? 'true' : 'false',
      'checksum': settings.checksumAlgorithm,
      'continue-on-checksum-error': settings.continueOnChecksumError ? 'true' : 'false',
      'check-certificate': settings.checkCertificate ? 'true' : 'false'
    }

    // 可选的字符串设置
    if (settings.rpcSecret) options['rpc-secret'] = settings.rpcSecret
    if (settings.fileAllocationMode && !isWindows.value) options['file-allocation-mode'] = settings.fileAllocationMode
    if (settings.caCertificate) options['ca-certificate'] = settings.caCertificate
    if (settings.certificate) options['certificate'] = settings.certificate
    if (settings.privateKey) options['private-key'] = settings.privateKey

    await aria2Store.changeGlobalOptions(options)
    ElMessage.success('安全设置已保存')
  } catch (error) {
    ElMessage.error('保存安全设置失败')
    console.error('Failed to save security settings:', error)
  } finally {
    saving.value = false
  }
}

async function resetToDefaults() {
  try {
    await ElMessageBox.confirm(
      '确定要恢复为默认安全设置吗？',
      '确认恢复',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // 恢复默认值
    Object.assign(settings, {
      rpcSecret: '',
      rpcListenAll: false,
      enableRpcForAll: false,
      allowOverwrite: false,
      autoFileRenaming: true,
      forceSave: false,
      fileAllocationMode: '644',
      checkIntegrity: false,
      checksumCheck: true,
      checksumAlgorithm: 'sha-1',
      continueOnChecksumError: false,
      checkCertificate: true,
      caCertificate: '',
      certificate: '',
      privateKey: ''
    })

    ElMessage.success('已恢复为默认安全设置')
  } catch (error) {
    // 用户取消
  }
}
</script>

<style scoped>
.security-settings {
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
