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
  Connection
} from '@element-plus/icons-vue'
import ConnectionDialog from '@/components/dialogs/ConnectionDialog.vue'

const aria2Store = useAria2Store()
const appVersion = ref('1.0.0')
const showConnectionDialog = ref(false)



// 计算属性
const isConnected = computed(() => aria2Store.isConnected)
const connectionStatus = computed(() => {
  if (aria2Store.isConnecting) return '连接中...'
  return aria2Store.isConnected ? '已连接' : '未连接'
})



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
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  padding: 0 16px;
  box-shadow: var(--shadow-light);
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
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
  color: var(--color-primary);
}

.version {
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
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
</style>
