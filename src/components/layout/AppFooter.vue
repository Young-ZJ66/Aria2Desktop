<template>
  <div class="app-footer">
    <div class="global-stats">
      <span
        class="stat-item"
        :aria-label="`${t('footer.downloadSpeed')}: ${formatSpeed(globalStat.downloadSpeed)}`"
      >
        <n-icon :size="14"><DownloadOutline /></n-icon>
        {{ formatSpeed(globalStat.downloadSpeed) }}
      </span>
      <span
        class="stat-item"
        :aria-label="`${t('footer.uploadSpeed')}: ${formatSpeed(globalStat.uploadSpeed)}`"
      >
        <n-icon :size="14"><CloudUploadOutline /></n-icon>
        {{ formatSpeed(globalStat.uploadSpeed) }}
      </span>
      <n-divider vertical />
      <span class="stat-item" :aria-label="`${t('footer.active')}: ${globalStat.numActive}`">
        {{ t('footer.active') }}: {{ globalStat.numActive }}
      </span>
      <span class="stat-item" :aria-label="`${t('footer.waiting')}: ${globalStat.numWaiting}`">
        {{ t('footer.waiting') }}: {{ globalStat.numWaiting }}
      </span>
      <span class="stat-item" :aria-label="`${t('footer.stopped')}: ${globalStat.numStopped}`">
        {{ t('footer.stopped') }}: {{ globalStat.numStopped }}
      </span>
    </div>

    <!-- 限速快捷开关 -->
    <button
      class="speed-limit-btn"
      :class="{ active: statsStore.isSpeedLimited }"
      :title="statsStore.isSpeedLimited ? t('footer.speedLimitOn') + ': ' + statsStore.speedLimitDisplay : t('footer.speedLimitOff')"
      @click="handleToggleSpeedLimit"
    >
      <n-icon :size="14"><SpeedometerOutline /></n-icon>
      <span v-if="statsStore.isSpeedLimited" class="speed-limit-text">{{ statsStore.speedLimitDisplay }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStatsStore } from '@/stores/statsStore'
import { formatSpeed } from '@/utils/taskFormatters'
import { DownloadOutline, CloudUploadOutline, SpeedometerOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'

const statsStore = useStatsStore()
const { t } = useI18n()

const globalStat = computed(() => statsStore.globalStat)

async function handleToggleSpeedLimit() {
  try {
    await statsStore.toggleSpeedLimit()
    const text = statsStore.isSpeedLimited
      ? `${t('footer.speedLimitOn')}: ${statsStore.speedLimitDisplay}`
      : t('footer.speedLimitOff')
    message.success(text)
  } catch {
    // 忽略切换失败
  }
}
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

.speed-limit-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s ease, background-color 0.2s ease;
}

.speed-limit-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.speed-limit-btn.active {
  color: var(--color-warning);
}

.speed-limit-text {
  font-size: 11px;
  font-weight: 500;
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
