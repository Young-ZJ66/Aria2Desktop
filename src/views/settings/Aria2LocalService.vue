<template>
  <div class="aria2-local-service">
    <div class="settings-header">
      <h2>本地 Aria2 服务</h2>
      <p class="settings-description">管理内置的 Aria2 服务，让小白用户也能轻松使用</p>
    </div>

    <!-- 服务状态卡片 -->
    <el-card class="status-card">
      <template #header>
        <div class="card-header">
          <span class="header-title">服务状态</span>
          <el-button 
            size="small" 
            @click="refreshStatus" 
            :loading="isRefreshing"
            circle
          >
            <el-icon><Refresh /></el-icon>
          </el-button>
        </div>
      </template>

      <div class="status-content">
        <div class="status-row">
          <span class="status-label">运行状态：</span>
          <el-tag 
            :type="isRunning ? 'success' : 'danger'" 
            size="large"
          >
            {{ isRunning ? '运行中' : '已停止' }}
          </el-tag>
        </div>

        <div class="status-row" v-if="hasError">
          <span class="status-label">错误信息：</span>
          <el-tag type="danger">{{ processInfo.error }}</el-tag>
        </div>
      </div>

      <div class="control-buttons">
        <el-space size="large">
          <el-button 
            :type="isRunning ? 'danger' : 'primary'"
            @click="isRunning ? stopService() : startService()"
            :loading="isStarting || isStopping"
            :disabled="!canStart && !canStop"
          >
            <el-icon><VideoPlay v-if="!isRunning" /><VideoPause v-else /></el-icon>
            {{ isRunning ? '停止' : '启动' }}
          </el-button>

          <el-button 
            type="warning" 
            @click="restartService"
            :loading="isStarting || isStopping"
            :disabled="!canRestart"
          >
            <el-icon><Refresh /></el-icon>
            重启
          </el-button>

          <el-button 
            :type="aria2Store.isConnected ? 'warning' : 'success'"
            @click="aria2Store.isConnected ? disconnectFromLocal() : connectToLocal()"
            :loading="isConnecting"
            :disabled="!isRunning"
          >
            <el-icon><Link v-if="!aria2Store.isConnected" /><Close v-else /></el-icon>
            {{ aria2Store.isConnected ? '断开' : '连接' }}
          </el-button>
        </el-space>
      </div>
    </el-card>

    <!-- 服务配置 -->
    <el-card class="config-card">
      <template #header>
        <span class="header-title">服务配置</span>
      </template>

      <el-form
        ref="configFormRef"
        :model="localConfig"
        :rules="configRules"
        label-width="150px"
        style="max-width: 600px"
      >
        <el-form-item label="监听端口" prop="port">
          <el-input-number
            v-model="localConfig.port"
            :min="1024"
            :max="65535"
            style="width: 200px"
          />
          <div class="form-tip">Aria2 RPC 服务监听的端口号</div>
        </el-form-item>

        <el-form-item label="访问密钥" prop="secret">
          <el-input
            v-model="localConfig.secret"
            type="password"
            placeholder="留空则自动生成"
            show-password
            clearable
          />
          <div class="form-tip">RPC 接口的访问密钥，提高安全性</div>
        </el-form-item>

        <el-form-item label="下载目录" prop="downloadDir">
          <el-input
            v-model="localConfig.downloadDir"
            placeholder="留空使用默认目录"
          >
            <template #append>
              <el-button @click="selectDownloadDir">
                <el-icon><Folder /></el-icon>
                选择
              </el-button>
            </template>
          </el-input>
          <div class="form-tip">文件下载保存的默认目录</div>
        </el-form-item>

        <el-form-item label="自动启动">
          <el-switch 
            v-model="localConfig.autoStart" 
            @change="updateAutoStart"
          />
          <div class="form-tip">应用启动时自动启动 Aria2 服务</div>
        </el-form-item>

        <el-form-item>
          <el-space>
            <el-button 
              type="primary" 
              @click="saveConfig"
              :loading="isSavingConfig"
            >
              保存配置
            </el-button>
            <el-button @click="resetConfig">重置配置</el-button>
          </el-space>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 内置 Aria2 不可用提示 -->
    <el-card class="guide-card" v-if="isElectronAvailable && processInfo.isAria2Available === false">
      <template #header>
        <span class="header-title">内置 Aria2 不可用</span>
      </template>

      <el-alert
        title="内置 Aria2 文件未找到"
        type="warning"
        :closable="false"
        show-icon
      >
        <template #default>
          <p>应用中没有找到内置的 Aria2 可执行文件。</p>
          <p><strong>解决方案：</strong></p>
          <ol>
            <li>请确保您下载的是完整版本的 Aria2Desktop</li>
            <li>或者手动下载 Aria2 并将 aria2c.exe 放置到用户数据目录</li>
            <li>也可以安装系统版本的 Aria2 并配置路径</li>
          </ol>
          <p v-if="processInfo.resourceInfo">
            <strong>用户数据目录：</strong><br>
            <code>{{ processInfo.resourceInfo.userDataPath }}</code>
          </p>
        </template>
      </el-alert>
    </el-card>

    <!-- 安装指南 -->
    <el-card class="guide-card" v-if="!isElectronAvailable">
      <template #header>
        <span class="header-title">安装指南</span>
      </template>

      <el-alert
        title="本功能仅在桌面应用中可用"
        type="info"
        :closable="false"
        show-icon
      >
        <template #default>
          <p>本地 Aria2 服务管理功能需要在 Electron 桌面应用中使用。</p>
          <p>如果您正在使用 Web 版本，请下载桌面版应用以享受完整功能。</p>
        </template>
      </el-alert>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { 
  Refresh, 
  VideoPlay, 
  VideoPause, 
  Folder, 
  Link,
  Close
} from '@element-plus/icons-vue'
import { useAria2LocalService, type Aria2LocalConfig } from '@/composables/useAria2LocalService'
import { useAria2Store } from '@/stores/aria2Store'

const aria2Store = useAria2Store()
const {
  processInfo,
  isRunning,
  hasError,
  canStart,
  canStop,
  canRestart,
  isStarting,
  isStopping,
  isElectronAvailable,
  start,
  stop,
  restart,
  getStatus,
  updateConfig,
  getConnectionConfig
} = useAria2LocalService()

const configFormRef = ref<FormInstance>()
const isRefreshing = ref(false)
const isSavingConfig = ref(false)
const isConnecting = ref(false)

// 本地配置表单 - 所有值都将从配置文件加载
const localConfig = reactive<Aria2LocalConfig>({
  port: 0, // 将从配置文件读取
  secret: '', // 将从配置文件读取
  downloadDir: '', // 将从配置文件读取
  autoStart: false // 将从配置文件读取
})

// 表单验证规则
const configRules: FormRules = {
  port: [
    { type: 'number', min: 1024, max: 65535, message: '端口号必须在 1024-65535 之间', trigger: 'blur' }
  ]
}

// 刷新状态
async function refreshStatus() {
  isRefreshing.value = true
  try {
    await getStatus()
    // 刷新状态后重新加载配置到表单
    loadCurrentConfig()
    ElMessage.success('状态已刷新')
  } catch (error) {
    ElMessage.error('刷新状态失败')
  } finally {
    isRefreshing.value = false
  }
}

// 启动服务
async function startService() {
  const success = await start()
  if (success) {
    // 启动成功后重新加载配置到表单
    loadCurrentConfig()
    ElMessage.success('Aria2 服务已启动')
  }
}

// 停止服务
async function stopService() {
  try {
    await ElMessageBox.confirm(
      '确定要停止 Aria2 服务吗？这将中断所有正在进行的下载。',
      '确认停止',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    await stop()
  } catch (error) {
    // 用户取消
  }
}

// 重启服务
async function restartService() {
  try {
    await ElMessageBox.confirm(
      '确定要重启 Aria2 服务吗？这将暂时中断所有正在进行的下载。',
      '确认重启',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    await restart()
  } catch (error) {
    // 用户取消
  }
}

// 选择下载目录
async function selectDownloadDir() {
  if (!window.electronAPI) {
    ElMessage.error('此功能仅在桌面应用中可用')
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      title: '选择下载目录',
      properties: ['openDirectory'],
      defaultPath: localConfig.downloadDir
    })

    if (!result.canceled && result.filePaths.length > 0) {
      localConfig.downloadDir = result.filePaths[0]
    }
  } catch (error) {
    ElMessage.error('选择目录失败')
    console.error('选择目录失败:', error)
  }
}

// 保存配置
async function saveConfig() {
  if (!configFormRef.value) return

  try {
    await configFormRef.value.validate()
  } catch {
    return
  }

  isSavingConfig.value = true

  try {
    // 如果服务正在运行，先询问用户是否要保存并重启
    if (isRunning.value) {
      try {
        await ElMessageBox.confirm(
          'Aria2 服务正在运行中。保存配置需要重启服务以应用新配置，是否继续？',
          '确认保存配置',
          {
            confirmButtonText: '保存并重启',
            cancelButtonText: '取消',
            type: 'warning'
          }
        )
        
        // 用户确认后，保存配置并重启服务
        const success = await updateConfig(localConfig)
        if (success) {
          ElMessage.success('配置已保存，正在重启服务...')
          await restart()
        }
      } catch {
        // 用户取消，不保存配置
        ElMessage.info('已取消保存配置')
        return
      }
    } else {
      // 服务未运行，直接保存配置
      const success = await updateConfig(localConfig)
      if (success) {
        ElMessage.success('配置已保存')
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('保存配置失败:', error)
    
    if (errorMessage.includes('下载目录验证失败')) {
      ElMessage.error('下载目录无效，请检查路径是否正确且具有写入权限')
    } else if (errorMessage.includes('启动失败')) {
      ElMessage.error('服务重启失败，请检查配置是否正确')
    } else {
      ElMessage.error(`保存配置失败: ${errorMessage}`)
    }
  } finally {
    isSavingConfig.value = false
  }
}

// 更新自动启动设置
const updateAutoStart = (value: boolean) => {
  console.log('Auto-start changed to:', value)
  localConfig.autoStart = value
  updateConfig(localConfig)
}

// 重置配置
function resetConfig() {
  Object.assign(localConfig, {
    port: 6800,
    secret: '',
    downloadDir: 'D:/Downloads/Aria2Downloads',
    autoStart: true
  })
  ElMessage.success('配置已重置')
}

// 连接到本地服务
async function connectToLocal() {
  if (!isRunning.value) {
    ElMessage.warning('请先启动本地 Aria2 服务')
    return
  }

  isConnecting.value = true

  try {
    const config = getConnectionConfig.value
    console.log('尝试连接配置:', {
      host: config.host,
      port: config.port,
      protocol: config.protocol,
      secret: config.secret ? '***' : '(无密钥)'
    })
    
    // 更新 Aria2Store 的连接配置
    aria2Store.updateConfig({
      host: config.host,
      port: config.port,
      protocol: config.protocol as 'http' | 'https',
      secret: config.secret
    })

    // 尝试连接
    await aria2Store.connect()
    ElMessage.success('已连接到本地 Aria2 服务')
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    ElMessage.error(`连接到本地服务失败: ${errorMessage}`)
    console.error('连接失败详情:', error)
    console.error('连接配置:', getConnectionConfig.value)
  } finally {
    isConnecting.value = false
  }
}

// 断开连接
function disconnectFromLocal() {
  try {
    aria2Store.disconnect()
    ElMessage.success('已断开与 Aria2 服务的连接')
  } catch (error) {
    ElMessage.error('断开连接失败')
    console.error('断开连接失败:', error)
  }
}

// 加载当前配置到表单
function loadCurrentConfig() {
  // 每次都重新获取最新状态，确保配置是最新的
  getStatus().then(() => {
    if (processInfo.value.config) {
      // 完全使用配置文件中的值，不使用任何默认值
      localConfig.port = processInfo.value.config.port
      localConfig.secret = processInfo.value.config.secret
      localConfig.autoStart = processInfo.value.config.autoStart
      localConfig.downloadDir = processInfo.value.config.downloadDir
      
      // 调试输出
      console.log('processInfo.value:', processInfo.value)
      console.log('processInfo.value.config:', processInfo.value.config)
      console.log('从后端获取的完整配置:', processInfo.value.config)
      console.log('设置到UI的配置:', {
        port: localConfig.port,
        downloadDir: localConfig.downloadDir,
        secret: localConfig.secret,
        autoStart: localConfig.autoStart
      })
    } else {
      // 如果没有配置信息，使用默认值
      Object.assign(localConfig, {
        port: 6800,
        secret: '',
        downloadDir: 'D:/Downloads/Aria2Downloads',
        autoStart: true
      })
    }
  })
}

// 初始化
onMounted(async () => {
  if (isElectronAvailable.value) {
    // 先获取当前状态
    await getStatus()
    // 然后加载配置到表单
    loadCurrentConfig()
    
    console.log('页面初始化完成，当前配置:', localConfig)
  }
})
</script>

<style scoped>
.aria2-local-service {
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

.status-card,
.config-card,
.connection-card,
.guide-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  font-weight: 600;
  color: var(--text-primary);
}

.status-content {
  margin-bottom: 20px;
}

.status-row {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.status-label {
  min-width: 100px;
  font-weight: 500;
  color: var(--text-primary);
}

.path-tag {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.control-buttons {
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}

.form-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

.connection-info {
  line-height: 1.6;
}

.connection-details {
  margin: 16px 0;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 6px;
}

.detail-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  min-width: 100px;
  font-weight: 500;
  color: var(--text-primary);
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

/* 确保禁用按钮显示为正确的灰色状态 */
:deep(.el-button.is-disabled) {
  cursor: default !important;
  opacity: 0.6;
  background-color: var(--color-info-light-9, #f4f4f5) !important;
  border-color: var(--color-info-light-8, #e9e9eb) !important;
  color: var(--color-info, #909399) !important;
}

:deep(.el-button.is-disabled:hover) {
  cursor: default !important;
  background-color: var(--color-info-light-9, #f4f4f5) !important;
  border-color: var(--color-info-light-8, #e9e9eb) !important;
  color: var(--color-info, #909399) !important;
}

/* 深色主题下的禁用按钮样式 */
[data-theme="dark"] :deep(.el-button.is-disabled) {
  background-color: var(--bg-tertiary) !important;
  border-color: var(--border-base) !important;
  color: var(--text-secondary) !important;
  opacity: 0.6;
}

[data-theme="dark"] :deep(.el-button.is-disabled:hover) {
  background-color: var(--bg-tertiary) !important;
  border-color: var(--border-base) !important;
  color: var(--text-secondary) !important;
}
</style>
