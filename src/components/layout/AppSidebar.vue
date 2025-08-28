<template>
  <div class="app-sidebar">
    <div class="sidebar-header">
      <h3>下载管理</h3>
    </div>
    
    <el-menu
      :default-active="$route.path"
      router
      class="sidebar-menu"
    >
      <el-menu-item index="/downloading">
        <el-icon><Download /></el-icon>
        <span>下载任务 ({{ activeAndWaitingCount }})</span>
      </el-menu-item>
      
      <el-menu-item index="/completed">
        <el-icon><Check /></el-icon>
        <span>下载完成 ({{ stoppedTasks.length }})</span>
      </el-menu-item>
    </el-menu>
    
    <div class="sidebar-divider"></div>
    
    <div class="sidebar-header">
      <h3>设置</h3>
    </div>
    
    <el-menu
      :default-active="$route.path"
      router
      class="sidebar-menu"
    >
      <el-menu-item index="/settings/general">
        <el-icon><Setting /></el-icon>
        <span>常规设置</span>
      </el-menu-item>
      
      <el-sub-menu index="/settings/aria2">
        <template #title>
          <el-icon><Tools /></el-icon>
          <span>Aria2 设置</span>
        </template>
        
        <el-menu-item index="/settings/aria2/basic">基本设置</el-menu-item>
        <el-menu-item index="/settings/aria2/http-ftp-sftp">HTTP/FTP/SFTP</el-menu-item>
        <el-menu-item index="/settings/aria2/http">HTTP 设置</el-menu-item>
        <el-menu-item index="/settings/aria2/ftp-sftp">FTP/SFTP 设置</el-menu-item>
        <el-menu-item index="/settings/aria2/bt">BitTorrent 设置</el-menu-item>
        <el-menu-item index="/settings/aria2/metalink">Metalink 设置</el-menu-item>
        <el-menu-item index="/settings/aria2/rpc">RPC 设置</el-menu-item>
        <el-menu-item index="/settings/aria2/advanced">高级设置</el-menu-item>
      </el-sub-menu>
      
      <el-menu-item index="/status">
        <el-icon><Monitor /></el-icon>
        <span>Aria2 状态</span>
      </el-menu-item>
    </el-menu>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAria2Store } from '@/stores/aria2Store'
import {
  Download,
  Check,
  Setting,
  Tools,
  Monitor
} from '@element-plus/icons-vue'

const aria2Store = useAria2Store()

const activeTasks = computed(() => aria2Store.activeTasks)
const waitingTasks = computed(() => aria2Store.waitingTasks)
const stoppedTasks = computed(() => aria2Store.stoppedTasks)

// 合并正在下载和等待中的任务数量
const activeAndWaitingCount = computed(() =>
  activeTasks.value.length + waitingTasks.value.length
)
</script>

<style scoped>
.app-sidebar {
  width: 250px;
  background: var(--bg-primary);
  border-right: 1px solid var(--border-light);
  height: 100%;
  overflow-y: auto;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-light);
}

.sidebar-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-regular);
}

.sidebar-menu {
  border: none;
  background-color: var(--bg-primary);
}

.sidebar-divider {
  height: 1px;
  background: var(--border-light);
  margin: 8px 0;
}

:deep(.el-menu-item) {
  height: 40px;
  line-height: 40px;
  color: var(--text-regular);
  background-color: var(--bg-primary);
}

:deep(.el-menu-item:hover) {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
}

:deep(.el-menu-item.is-active) {
  background-color: var(--color-primary);
  color: #ffffff;
}

:deep(.el-sub-menu .el-menu-item) {
  height: 36px;
  line-height: 36px;
  padding-left: 50px !important;
}
</style>
