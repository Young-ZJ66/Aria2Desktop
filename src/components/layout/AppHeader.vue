<template>
  <div class="app-header">
    <div class="header-left">
      <div class="logo">
        <span class="logo-text">Aria2 Desktop</span>
        <span class="version">v{{ appVersion }}</span>
      </div>
    </div>
    
    <div class="header-center">
      <!-- 可以在这里添加其他中间内容 -->
    </div>
    
    <div class="header-right">
      <div class="search-box">
        <el-input
          v-model="searchText"
          placeholder="搜索任务..."
          :prefix-icon="Search"
          clearable
          @input="handleSearch"
        />
      </div>

      <el-button
        :icon="Connection"
        :type="isConnected ? 'success' : 'danger'"
        @click="showConnectionDialog = true"
      >
        {{ connectionStatus }}
      </el-button>
    </div>
    
    <!-- 连接对话框 -->
    <ConnectionDialog v-model="showConnectionDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAria2Store } from '@/stores/aria2Store'
import {
  Search,
  Connection
} from '@element-plus/icons-vue'
import ConnectionDialog from '@/components/dialogs/ConnectionDialog.vue'

const aria2Store = useAria2Store()
const appVersion = ref('1.0.0')
const searchText = ref('')
const showConnectionDialog = ref(false)

// 计算属性
const isConnected = computed(() => aria2Store.isConnected)
const connectionStatus = computed(() => {
  if (aria2Store.isConnecting) return '连接中...'
  return aria2Store.isConnected ? '已连接' : '未连接'
})

// 方法
function handleSearch(value: string) {
  // TODO: 实现全局搜索功能
  console.log('Global search:', value)
}

onMounted(async () => {
  // 获取应用版本
  if (window.electronAPI) {
    try {
      appVersion.value = await window.electronAPI.getAppVersion()
    } catch (error) {
      console.error('Failed to get app version:', error)
    }
  }
})
</script>

<style scoped>
.app-header {
  height: 60px;
  background: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  padding: 0 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-left {
  flex: 0 0 auto;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-text {
  font-size: 18px;
  font-weight: bold;
  color: #409eff;
}

.version {
  font-size: 12px;
  color: #909399;
  background: #f4f4f5;
  padding: 2px 6px;
  border-radius: 4px;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.header-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 16px;
}

.search-box {
  width: 200px;
}
</style>
