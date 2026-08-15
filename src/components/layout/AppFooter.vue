<template>
  <div class="app-footer">
    <div class="footer-left">
      <div class="global-stats">
        <span class="stat-item">
          <n-icon :size="14"><DownloadOutline /></n-icon>
          {{ formatSpeed(globalStat.downloadSpeed) }}
        </span>
        <span class="stat-item">
          <n-icon :size="14"><CloudUploadOutline /></n-icon>
          {{ formatSpeed(globalStat.uploadSpeed) }}
        </span>
        <n-divider vertical />
        <span class="stat-item">
          {{ t('footer.active') }}: {{ globalStat.numActive }}
        </span>
        <span class="stat-item">
          {{ t('footer.waiting') }}: {{ globalStat.numWaiting }}
        </span>
        <span class="stat-item">
          {{ t('footer.stopped') }}: {{ globalStat.numStopped }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStatsStore } from '@/stores/statsStore'
import { formatSpeed } from '@/utils/taskFormatters'
import { DownloadOutline, CloudUploadOutline } from '@vicons/ionicons5'

const statsStore = useStatsStore()
const { t } = useI18n()

const globalStat = computed(() => statsStore.globalStat)
</script>

<style scoped>
.app-footer {
  height: 40px;
  background: var(--bg-primary);
  border-top: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  font-size: 12px;
  color: var(--text-regular);
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}

.footer-left {
  flex: 1;
}

.global-stats {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
