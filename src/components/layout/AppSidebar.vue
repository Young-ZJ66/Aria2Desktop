<template>
  <div class="app-sidebar">
    <div class="sidebar-header">
      <h3>{{ t('app.downloadManager') }}</h3>
    </div>

    <el-menu
      :default-active="$route.path"
      router
      class="sidebar-menu"
    >
      <el-menu-item index="/downloading">
        <el-icon><Download /></el-icon>
        <span>{{ t('nav.downloading') }} ({{ activeAndWaitingCount }})</span>
      </el-menu-item>

      <el-menu-item index="/completed">
        <el-icon><Check /></el-icon>
        <span>{{ t('nav.completed') }} ({{ stoppedTasks.length }})</span>
      </el-menu-item>
    </el-menu>

    <div class="sidebar-divider" />

    <div class="sidebar-header">
      <h3>{{ t('app.settings') }}</h3>
    </div>

    <el-menu
      :default-active="$route.path"
      router
      class="sidebar-menu"
    >
      <el-menu-item index="/settings/general">
        <el-icon><Setting /></el-icon>
        <span>{{ t('nav.generalSettings') }}</span>
      </el-menu-item>

      <el-sub-menu index="/settings/aria2">
        <template #title>
          <el-icon><Tools /></el-icon>
          <span>{{ t('nav.aria2Settings') }}</span>
        </template>

        <el-menu-item index="/settings/aria2/local-service">{{ t('nav.localService') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/basic">{{ t('nav.basicSettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/connection">{{ t('nav.connectionSettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/http">{{ t('nav.httpSettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/ftp-sftp">{{ t('nav.ftpSftpSettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/bt">{{ t('nav.btSettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/metalink">{{ t('nav.metalinkSettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/performance">{{ t('nav.performanceSettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/security">{{ t('nav.securitySettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/advanced">{{ t('nav.advancedSettings') }}</el-menu-item>
        <el-menu-item index="/settings/aria2/rpc">{{ t('nav.rpcSettings') }}</el-menu-item>
      </el-sub-menu>

      <el-menu-item index="/status">
        <el-icon><Monitor /></el-icon>
        <span>{{ t('nav.aria2Status') }}</span>
      </el-menu-item>
    </el-menu>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTaskStore } from '@/stores/taskStore'
import {
  Download,
  Check,
  Setting,
  Tools,
  Monitor
} from '@element-plus/icons-vue'

const { t } = useI18n()
const taskStore = useTaskStore()

const activeTasks = computed(() => taskStore.activeTasks)
const waitingTasks = computed(() => taskStore.waitingTasks)
const stoppedTasks = computed(() => taskStore.stoppedTasks)

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
