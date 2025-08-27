<template>
  <div class="bt-settings">
    <div class="settings-header">
      <h2>BitTorrent 设置</h2>
      <p class="settings-description">配置 BitTorrent 下载相关参数</p>
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
          <span class="group-title">基本设置</span>
        </template>

        <el-form-item label="监听端口">
          <el-input-number
            v-model="settings.listenPort"
            :min="1024"
            :max="65535"
            style="width: 200px"
          />
          <div class="form-tip">BitTorrent 监听端口</div>
        </el-form-item>

        <el-form-item label="DHT 监听端口">
          <el-input-number
            v-model="settings.dhtListenPort"
            :min="1024"
            :max="65535"
            style="width: 200px"
          />
          <div class="form-tip">DHT 网络监听端口</div>
        </el-form-item>

        <el-form-item label="启用 DHT">
          <el-switch v-model="settings.enableDht" />
          <div class="form-tip">启用分布式哈希表</div>
        </el-form-item>

        <el-form-item label="启用 PEX">
          <el-switch v-model="settings.enablePeerExchange" />
          <div class="form-tip">启用对等交换</div>
        </el-form-item>

        <el-form-item label="启用 LPD">
          <el-switch v-model="settings.btEnableLpd" />
          <div class="form-tip">启用本地对等发现</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">连接设置</span>
        </template>

        <el-form-item label="最大连接数">
          <el-input-number
            v-model="settings.btMaxPeers"
            :min="1"
            :max="1000"
            style="width: 200px"
          />
          <div class="form-tip">每个种子的最大连接数</div>
        </el-form-item>

        <el-form-item label="最小分享率">
          <el-input-number
            v-model="settings.seedRatio"
            :min="0"
            :max="100"
            :step="0.1"
            :precision="1"
            style="width: 200px"
          />
          <div class="form-tip">达到此分享率后停止做种</div>
        </el-form-item>

        <el-form-item label="做种时间">
          <el-input-number
            v-model="settings.seedTime"
            :min="0"
            :max="999999"
            style="width: 200px"
          />
          <span style="margin-left: 8px">分钟</span>
          <div class="form-tip">做种时间限制，0 表示无限制</div>
        </el-form-item>

        <el-form-item label="最大上传速度">
          <el-input
            v-model="settings.maxUploadLimit"
            placeholder="0 表示无限制"
            style="width: 200px"
          />
          <span style="margin-left: 8px">KB/s</span>
          <div class="form-tip">全局最大上传速度限制</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">Tracker 设置</span>
        </template>

        <el-form-item label="Tracker 超时">
          <el-input-number
            v-model="settings.btTrackerTimeout"
            :min="1"
            :max="600"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">Tracker 请求超时时间</div>
        </el-form-item>

        <el-form-item label="Tracker 间隔">
          <el-input-number
            v-model="settings.btTrackerInterval"
            :min="0"
            :max="86400"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">Tracker 请求间隔时间</div>
        </el-form-item>

        <el-form-item label="额外 Tracker">
          <el-input
            v-model="settings.btTracker"
            type="textarea"
            :rows="6"
            placeholder="额外的 Tracker 服务器，每行一个"
          />
          <div class="form-tip">额外的 Tracker 服务器列表</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">高级设置</span>
        </template>

        <el-form-item label="强制加密">
          <el-switch v-model="settings.btRequireCrypto" />
          <div class="form-tip">强制使用加密连接</div>
        </el-form-item>

        <el-form-item label="最小加密级别">
          <el-select v-model="settings.btMinCryptoLevel" style="width: 200px">
            <el-option label="纯文本" value="plain" />
            <el-option label="ARC4" value="arc4" />
          </el-select>
          <div class="form-tip">最小加密级别</div>
        </el-form-item>

        <el-form-item label="保存元数据">
          <el-switch v-model="settings.btSaveMetadata" />
          <div class="form-tip">保存种子元数据为 .torrent 文件</div>
        </el-form-item>

        <el-form-item label="移除未选择文件">
          <el-switch v-model="settings.btRemoveUnselectedFile" />
          <div class="form-tip">移除未选择下载的文件</div>
        </el-form-item>

        <el-form-item label="外部 IP">
          <el-input
            v-model="settings.btExternalIp"
            placeholder="自动检测"
            style="width: 200px"
          />
          <div class="form-tip">向 Tracker 报告的外部 IP 地址</div>
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

// BitTorrent 设置
const settings = reactive({
  listenPort: 6881,
  dhtListenPort: 6881,
  enableDht: true,
  enablePeerExchange: true,
  btEnableLpd: false,
  btMaxPeers: 55,
  seedRatio: 1.0,
  seedTime: 0,
  maxUploadLimit: '0',
  btTrackerTimeout: 60,
  btTrackerInterval: 0,
  btTracker: '',
  btRequireCrypto: false,
  btMinCryptoLevel: 'plain',
  btSaveMetadata: false,
  btRemoveUnselectedFile: false,
  btExternalIp: ''
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
      settings.listenPort = parseInt(options['listen-port'] || '6881')
      settings.dhtListenPort = parseInt(options['dht-listen-port'] || '6881')
      settings.enableDht = options['enable-dht'] !== 'false'
      settings.enablePeerExchange = options['enable-peer-exchange'] !== 'false'
      settings.btEnableLpd = options['bt-enable-lpd'] === 'true'
      settings.btMaxPeers = parseInt(options['bt-max-peers'] || '55')
      settings.seedRatio = parseFloat(options['seed-ratio'] || '1.0')
      settings.seedTime = parseInt(options['seed-time'] || '0')
      settings.maxUploadLimit = options['max-upload-limit'] || '0'
      settings.btTrackerTimeout = parseInt(options['bt-tracker-timeout'] || '60')
      settings.btTrackerInterval = parseInt(options['bt-tracker-interval'] || '0')
      settings.btTracker = options['bt-tracker'] || ''
      settings.btRequireCrypto = options['bt-require-crypto'] === 'true'
      settings.btMinCryptoLevel = options['bt-min-crypto-level'] || 'plain'
      settings.btSaveMetadata = options['bt-save-metadata'] === 'true'
      settings.btRemoveUnselectedFile = options['bt-remove-unselected-file'] === 'true'
      settings.btExternalIp = options['bt-external-ip'] || ''
    }
    ElMessage.success('设置加载成功')
  } catch (error) {
    ElMessage.error('加载设置失败')
    console.error('Failed to load BT settings:', error)
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
      'listen-port': settings.listenPort.toString(),
      'dht-listen-port': settings.dhtListenPort.toString(),
      'enable-dht': settings.enableDht ? 'true' : 'false',
      'enable-peer-exchange': settings.enablePeerExchange ? 'true' : 'false',
      'bt-enable-lpd': settings.btEnableLpd ? 'true' : 'false',
      'bt-max-peers': settings.btMaxPeers.toString(),
      'seed-ratio': settings.seedRatio.toString(),
      'seed-time': settings.seedTime.toString(),
      'max-upload-limit': settings.maxUploadLimit,
      'bt-tracker-timeout': settings.btTrackerTimeout.toString(),
      'bt-tracker-interval': settings.btTrackerInterval.toString(),
      'bt-require-crypto': settings.btRequireCrypto ? 'true' : 'false',
      'bt-min-crypto-level': settings.btMinCryptoLevel,
      'bt-save-metadata': settings.btSaveMetadata ? 'true' : 'false',
      'bt-remove-unselected-file': settings.btRemoveUnselectedFile ? 'true' : 'false'
    }

    if (settings.btTracker) options['bt-tracker'] = settings.btTracker
    if (settings.btExternalIp) options['bt-external-ip'] = settings.btExternalIp

    await aria2Store.changeGlobalOptions(options)
    ElMessage.success('设置保存成功')
  } catch (error) {
    ElMessage.error('保存设置失败')
    console.error('Failed to save BT settings:', error)
  } finally {
    saving.value = false
  }
}

function resetSettings() {
  settings.listenPort = 6881
  settings.dhtListenPort = 6881
  settings.enableDht = true
  settings.enablePeerExchange = true
  settings.btEnableLpd = false
  settings.btMaxPeers = 55
  settings.seedRatio = 1.0
  settings.seedTime = 0
  settings.maxUploadLimit = '0'
  settings.btTrackerTimeout = 60
  settings.btTrackerInterval = 0
  settings.btTracker = ''
  settings.btRequireCrypto = false
  settings.btMinCryptoLevel = 'plain'
  settings.btSaveMetadata = false
  settings.btRemoveUnselectedFile = false
  settings.btExternalIp = ''

  ElMessage.info('已重置为默认值')
}
</script>

<style scoped>
.bt-settings {
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
