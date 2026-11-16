<template>
  <footer class="app-footer">
    <div class="footer-stats">
      <span class="stat" :aria-label="`${t('footer.downloadSpeed')}: ${formatSpeed(globalStat.downloadSpeed)}`">
        <n-icon :size="13" class="stat__icon"><DownloadOutline /></n-icon>
        <span class="stat__value ds-tnum">{{ formatSpeed(globalStat.downloadSpeed) }}</span>
      </span>
      <span class="stat" :aria-label="`${t('footer.uploadSpeed')}: ${formatSpeed(globalStat.uploadSpeed)}`">
        <n-icon :size="13" class="stat__icon"><CloudUploadOutline /></n-icon>
        <span class="stat__value ds-tnum">{{ formatSpeed(globalStat.uploadSpeed) }}</span>
      </span>

      <span class="footer-sep" aria-hidden="true" />

      <span class="stat stat--count" :aria-label="`${t('footer.active')}: ${globalStat.numActive}`">
        <span class="stat__label">{{ t('footer.active') }}</span>
        <span class="stat__value ds-tnum">{{ globalStat.numActive }}</span>
      </span>
      <span class="stat stat--count" :aria-label="`${t('footer.waiting')}: ${globalStat.numWaiting}`">
        <span class="stat__label">{{ t('footer.waiting') }}</span>
        <span class="stat__value ds-tnum">{{ globalStat.numWaiting }}</span>
      </span>
      <span class="stat stat--count" :aria-label="`${t('footer.stopped')}: ${globalStat.numStopped}`">
        <span class="stat__label">{{ t('footer.stopped') }}</span>
        <span class="stat__value ds-tnum">{{ globalStat.numStopped }}</span>
      </span>
    </div>

    <!--
      限速入口：v1 是「左键开关 + 右键选档位」——右键菜单没有可见提示，
      等于把选档位这件事藏了起来。v2 改成点击弹出面板，开关与档位都在里面。
    -->
    <n-popover
      trigger="click"
      placement="top-end"
      :show-arrow="false"
      :style="{ padding: '0' }"
      :disabled="false"
    >
      <template #trigger>
        <button
          type="button"
          class="limit-trigger"
          :class="{ 'is-limited': statsStore.isSpeedLimited }"
          aria-haspopup="dialog"
          :aria-label="`${t('footer.speedLimit')}: ${statsStore.isSpeedLimited ? statsStore.speedLimitDisplay : t('footer.speedLimitOff')}`"
        >
          <n-icon :size="13"><SpeedometerOutline /></n-icon>
          <span v-if="statsStore.isSpeedLimited" class="limit-trigger__value ds-tnum">
            {{ statsStore.speedLimitDisplay }}
          </span>
          <span v-else class="limit-trigger__value">{{ t('footer.speedLimit') }}</span>
        </button>
      </template>

      <div class="limit-pop">
        <div class="limit-pop__head">
          <span class="limit-pop__title">{{ t('footer.speedLimit') }}</span>
          <n-switch
            size="small"
            :value="statsStore.isSpeedLimited"
            :disabled="!connectionStore.service"
            @update:value="handleToggleSpeedLimit"
          />
        </div>

        <p v-if="!connectionStore.service" class="limit-pop__hint">
          {{ t('footer.speedLimitNoEngine') }}
        </p>

        <div v-else class="limit-pop__grid" role="group" :aria-label="t('footer.speedLimit')">
          <button
            v-for="preset in LIMIT_PRESETS"
            :key="preset.key"
            type="button"
            class="limit-chip"
            :class="{ 'is-active': currentLimitBytes === preset.bytes }"
            :aria-pressed="currentLimitBytes === preset.bytes"
            @click="applyPreset(preset.bytes)"
          >
            {{ preset.label }}
          </button>
        </div>
      </div>
    </n-popover>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon, NPopover, NSwitch } from 'naive-ui'
import { useStatsStore } from '@/stores/statsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { formatSpeed } from '@/utils/taskFormatters'
import { DownloadOutline, CloudUploadOutline, SpeedometerOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'

const statsStore = useStatsStore()
const connectionStore = useConnectionStore()
const { t } = useI18n()

const globalStat = computed(() => statsStore.globalStat)

const LIMIT_PRESETS = [
  { key: '512k', label: '512K', bytes: 512 * 1024 },
  { key: '1m', label: '1M', bytes: 1024 * 1024 },
  { key: '2m', label: '2M', bytes: 2 * 1024 * 1024 },
  { key: '5m', label: '5M', bytes: 5 * 1024 * 1024 },
  { key: '10m', label: '10M', bytes: 10 * 1024 * 1024 }
] as const

const currentLimitBytes = computed(() => {
  const raw = statsStore.globalOptions['max-overall-download-limit']
  const bytes = Number(raw)
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0
})

async function handleToggleSpeedLimit(value: boolean) {
  if (!connectionStore.service) {
    message.warning(t('footer.speedLimitNoEngine'))
    return
  }
  try {
    await statsStore.toggleSpeedLimit()
    message.success(value ? t('footer.speedLimitOn') : t('footer.speedLimitOff'))
  } catch {
    message.error(t('footer.speedLimitToggleFailed'))
  }
}

async function applyPreset(bytes: number) {
  if (!connectionStore.service) {
    message.warning(t('footer.speedLimitNoEngine'))
    return
  }
  try {
    await statsStore.changeGlobalOptions({ 'max-overall-download-limit': String(bytes) })
    message.success(`${t('footer.speedLimitOn')}: ${formatSpeed(bytes)}/s`)
  } catch {
    message.error(t('footer.speedLimitToggleFailed'))
  }
}
</script>

<style scoped>
.app-footer {
  height: var(--ds-control-footer-height);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-16);
  padding: 0 var(--ds-space-16) 0 var(--ds-space-20);
  background: var(--ds-bg-surface);
  border-top: 1px solid var(--ds-border-subtle);
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
  transition:
    background-color var(--ds-motion-dur-4) var(--ds-motion-ease-in-out),
    border-color var(--ds-motion-dur-4) var(--ds-motion-ease-in-out);
}

.footer-stats {
  display: flex;
  align-items: center;
  gap: var(--ds-space-16);
  min-width: 0;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-space-6);
  white-space: nowrap;
}

.stat__icon {
  color: var(--ds-text-faint);
}

.stat__value {
  color: var(--ds-text-base);
  font-weight: 500;
}

.stat--count .stat__label {
  color: var(--ds-text-faint);
}

.stat--count .stat__value {
  color: var(--ds-text-muted);
  font-weight: 600;
}

.footer-sep {
  width: 1px;
  height: 14px;
  background: var(--ds-border-subtle);
}

.limit-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-space-6);
  height: 24px;
  padding: 0 var(--ds-space-8);
  border: 1px solid transparent;
  border-radius: var(--ds-radius-sm);
  background: transparent;
  color: var(--ds-text-muted);
  font-size: var(--ds-text-small-size);
  cursor: pointer;
  transition:
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    border-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.limit-trigger:hover {
  background: var(--ds-bg-hover);
  color: var(--ds-text-strong);
}

.limit-trigger:focus-visible {
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 2px;
}

.limit-trigger.is-limited {
  border-color: var(--ds-status-warning-subtle);
  background: var(--ds-status-warning-subtle);
  color: var(--ds-status-warning-text);
}

.limit-trigger__value {
  font-weight: 500;
}

.limit-pop {
  width: 216px;
  padding: var(--ds-space-12);
}

.limit-pop__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-12);
}

.limit-pop__title {
  font-size: var(--ds-text-small-size);
  font-weight: 600;
  color: var(--ds-text-strong);
}

.limit-pop__hint {
  margin: var(--ds-space-8) 0 0;
  font-size: var(--ds-text-micro-size);
  line-height: 1.5;
  color: var(--ds-text-muted);
}

.limit-pop__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--ds-space-6);
  margin-top: var(--ds-space-12);
}

.limit-chip {
  height: 28px;
  border: 1px solid var(--ds-border-base);
  border-radius: var(--ds-radius-sm);
  background: var(--ds-bg-surface);
  color: var(--ds-text-base);
  font-size: var(--ds-text-small-size);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    border-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.limit-chip:hover {
  border-color: var(--ds-border-strong);
  background: var(--ds-bg-hover);
}

.limit-chip.is-active {
  border-color: var(--ds-accent);
  background: var(--ds-accent-subtle);
  color: var(--ds-accent-text);
  font-weight: 600;
}

.limit-chip:focus-visible {
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 1px;
}

@media (max-width: 900px) {
  .stat--count {
    display: none;
  }
}
</style>
