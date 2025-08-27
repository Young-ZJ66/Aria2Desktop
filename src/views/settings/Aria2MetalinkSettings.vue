<template>
  <div class="metalink-settings">
    <div class="settings-header">
      <h2>Metalink 设置</h2>
      <p class="settings-description">配置 Metalink 协议相关参数</p>
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
          <span class="group-title">Metalink 设置</span>
        </template>

        <el-form-item label="启用 Metalink">
          <el-switch v-model="settings.followMetalink" />
          <div class="form-tip">启用 Metalink 支持</div>
        </el-form-item>

        <el-form-item label="Metalink 服务器">
          <el-input
            v-model="settings.metalinkServers"
            type="textarea"
            :rows="4"
            placeholder="Metalink 服务器列表，每行一个"
          />
          <div class="form-tip">额外的 Metalink 服务器</div>
        </el-form-item>

        <el-form-item label="首选服务器">
          <el-input
            v-model="settings.metalinkPreferredProtocol"
            placeholder="http,https,ftp"
          />
          <div class="form-tip">首选的协议，用逗号分隔</div>
        </el-form-item>

        <el-form-item label="语言">
          <el-input
            v-model="settings.metalinkLanguage"
            placeholder="zh-CN,en-US"
          />
          <div class="form-tip">首选语言，用逗号分隔</div>
        </el-form-item>

        <el-form-item label="位置">
          <el-input
            v-model="settings.metalinkLocation"
            placeholder="CN,US"
          />
          <div class="form-tip">首选位置，用逗号分隔</div>
        </el-form-item>

        <el-form-item label="操作系统">
          <el-input
            v-model="settings.metalinkOs"
            placeholder="linux,windows"
          />
          <div class="form-tip">首选操作系统，用逗号分隔</div>
        </el-form-item>

        <el-form-item label="版本">
          <el-input
            v-model="settings.metalinkVersion"
            placeholder="1.0,2.0"
          />
          <div class="form-tip">首选版本，用逗号分隔</div>
        </el-form-item>

        <el-form-item label="基础 URI">
          <el-input
            v-model="settings.metalinkBaseUri"
            placeholder="基础 URI"
          />
          <div class="form-tip">Metalink 文件的基础 URI</div>
        </el-form-item>

        <el-form-item label="启用唯一协议">
          <el-switch v-model="settings.metalinkEnableUniqueProtocol" />
          <div class="form-tip">每个协议只使用一个连接</div>
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
  followMetalink: true,
  metalinkServers: '',
  metalinkPreferredProtocol: 'https,http,ftp',
  metalinkLanguage: 'zh-CN,en-US',
  metalinkLocation: 'CN,US',
  metalinkOs: 'linux,windows',
  metalinkVersion: '',
  metalinkBaseUri: '',
  metalinkEnableUniqueProtocol: true
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
      settings.followMetalink = options['follow-metalink'] !== 'false'
      settings.metalinkServers = options['metalink-servers'] || ''
      settings.metalinkPreferredProtocol = options['metalink-preferred-protocol'] || 'https,http,ftp'
      settings.metalinkLanguage = options['metalink-language'] || 'zh-CN,en-US'
      settings.metalinkLocation = options['metalink-location'] || 'CN,US'
      settings.metalinkOs = options['metalink-os'] || 'linux,windows'
      settings.metalinkVersion = options['metalink-version'] || ''
      settings.metalinkBaseUri = options['metalink-base-uri'] || ''
      settings.metalinkEnableUniqueProtocol = options['metalink-enable-unique-protocol'] !== 'false'
    }
    ElMessage.success('设置加载成功')
  } catch (error) {
    ElMessage.error('加载设置失败')
    console.error('Failed to load Metalink settings:', error)
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
      'follow-metalink': settings.followMetalink ? 'true' : 'false',
      'metalink-preferred-protocol': settings.metalinkPreferredProtocol,
      'metalink-language': settings.metalinkLanguage,
      'metalink-location': settings.metalinkLocation,
      'metalink-os': settings.metalinkOs,
      'metalink-enable-unique-protocol': settings.metalinkEnableUniqueProtocol ? 'true' : 'false'
    }

    if (settings.metalinkServers) options['metalink-servers'] = settings.metalinkServers
    if (settings.metalinkVersion) options['metalink-version'] = settings.metalinkVersion
    if (settings.metalinkBaseUri) options['metalink-base-uri'] = settings.metalinkBaseUri

    await aria2Store.changeGlobalOptions(options)
    ElMessage.success('设置保存成功')
  } catch (error) {
    ElMessage.error('保存设置失败')
    console.error('Failed to save Metalink settings:', error)
  } finally {
    saving.value = false
  }
}

function resetSettings() {
  settings.followMetalink = true
  settings.metalinkServers = ''
  settings.metalinkPreferredProtocol = 'https,http,ftp'
  settings.metalinkLanguage = 'zh-CN,en-US'
  settings.metalinkLocation = 'CN,US'
  settings.metalinkOs = 'linux,windows'
  settings.metalinkVersion = ''
  settings.metalinkBaseUri = ''
  settings.metalinkEnableUniqueProtocol = true

  ElMessage.info('已重置为默认值')
}
</script>

<style scoped>
.metalink-settings {
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
