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

    <!-- 限速快捷开关：左键开关，右键/下拉箭头选档位 -->
    <n-dropdown
      trigger="manual"
      :show="limitMenuVisible"
      :x="limitMenuX"
      :y="limitMenuY"
      placement="top-end"
      :options="limitMenuOptions"
      @select="handleLimitPreset"
      @clickoutside="limitMenuVisible = false"
    />
    <button
      class="speed-limit-btn"
      :class="{ active: statsStore.isSpeedLimited }"
      :title="statsStore.isSpeedLimited ? t('footer.speedLimitOn') + ': ' + statsStore.speedLimitDisplay : t('footer.speedLimitOff')"
      @click="handleToggleSpeedLimit"
      @contextmenu.prevent="openLimitMenu"
    >
      <n-icon :size="14"><SpeedometerOutline /></n-icon>
      <span v-if="statsStore.isSpeedLimited" class="speed-limit-text">{{ statsStore.speedLimitDisplay }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DropdownOption } from 'naive-ui'
import { useStatsStore } from '@/stores/statsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { formatSpeed } from '@/utils/taskFormatters'
import { DownloadOutline, CloudUploadOutline, SpeedometerOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'

const statsStore = useStatsStore()
const connectionStore = useConnectionStore()
const { t } = useI18n()

const globalStat = computed(() => statsStore.globalStat)

async function handleToggleSpeedLimit() {
  // 未连接时 toggleSpeedLimit 会静默返回，若不拦住就会给用户一个"已关闭限速"的假成功
  if (!connectionStore.service) {
    message.warning(t('footer.speedLimitNoEngine'))
    return
  }

  try {
    await statsStore.toggleSpeedLimit()
    const text = statsStore.isSpeedLimited
      ? `${t('footer.speedLimitOn')}: ${statsStore.speedLimitDisplay}`
      : t('footer.speedLimitOff')
    message.success(text)
  } catch {
    // 以前这里什么都不提示：点了没反应，用户只会以为按钮坏了
    message.error(t('footer.speedLimitToggleFailed'))
  }
}

// ── 右键限速档位菜单 ──
/** 档位值（字节/秒）——与 changeGlobalOption 的原始值语义一致 */
const LIMIT_PRESETS: Array<{ key: string; bytes: number }> = [
  { key: '512k', bytes: 512 * 1024 },
  { key: '1m', bytes: 1024 * 1024 },
  { key: '2m', bytes: 2 * 1024 * 1024 },
  { key: '5m', bytes: 5 * 1024 * 1024 },
  { key: '10m', bytes: 10 * 1024 * 1024 }
]

const limitMenuVisible = ref(false)
const limitMenuX = ref(0)
const limitMenuY = ref(0)

const limitMenuOptions = computed<DropdownOption[]>(() => [
  ...LIMIT_PRESETS.map(p => ({
    key: p.key,
    label: formatSpeed(p.bytes) + ' /s'
  })),
  { type: 'divider', key: 'd1' },
  { key: 'off', label: t('footer.speedLimitOff') }
])

function openLimitMenu(e: MouseEvent) {
  if (!connectionStore.service) {
    message.warning(t('footer.speedLimitNoEngine'))
    return
  }
  limitMenuX.value = e.clientX
  limitMenuY.value = e.clientY
  limitMenuVisible.value = true
}

async function handleLimitPreset(key: string | number) {
  limitMenuVisible.value = false
  const value = key === 'off' ? '0' : LIMIT_PRESETS.find(p => p.key === key)?.bytes
  if (value === undefined) return
  try {
    await statsStore.changeGlobalOptions({ 'max-overall-download-limit': String(value) })
    message.success(key === 'off' ? t('footer.speedLimitOff') : `${t('footer.speedLimitOn')}: ${formatSpeed(value)}/s`)
  } catch {
    message.error(t('footer.speedLimitToggleFailed'))
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
