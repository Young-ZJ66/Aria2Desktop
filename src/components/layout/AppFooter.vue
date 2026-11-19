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
      v-model:show="showLimitPop"
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

        <div v-else class="limit-pop__form">
          <div class="limit-pop__row">
            <n-input
              v-model:value="limitInput"
              class="limit-pop__number"
              size="small"
              inputmode="decimal"
              :placeholder="t('footer.speedLimitPlaceholder')"
              :aria-label="t('footer.speedLimit')"
              @keydown.enter="applyLimit"
            />
            <div class="limit-pop__units" role="radiogroup" :aria-label="t('footer.speedLimit')">
              <button
                v-for="unit in SPEED_LIMIT_UNITS"
                :key="unit"
                type="button"
                role="radio"
                class="limit-unit"
                :class="{ 'is-active': limitUnit === unit }"
                :aria-checked="limitUnit === unit"
                @click="limitUnit = unit"
              >
                {{ unit }}/s
              </button>
            </div>
          </div>
          <n-button class="limit-pop__apply" size="small" type="primary" block @click="applyLimit">
            {{ t('common.ok') }}
          </n-button>
        </div>
      </div>
    </n-popover>
  </footer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NIcon, NInput, NPopover, NSwitch } from 'naive-ui'
import { useStatsStore } from '@/stores/statsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { formatSpeed } from '@/utils/taskFormatters'
import { DownloadOutline, CloudUploadOutline, SpeedometerOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import {
  SPEED_LIMIT_UNITS,
  fromSpeedLimitBytes,
  toSpeedLimitBytes,
  type SpeedLimitUnit
} from '@/utils/speedLimit'

const statsStore = useStatsStore()
const connectionStore = useConnectionStore()
const { t } = useI18n()

const globalStat = computed(() => statsStore.globalStat)

/** 当前生效的限速值（字节/秒），0 表示不限制 */
const currentLimitBytes = computed(() => {
  const raw = statsStore.globalOptions['max-overall-download-limit']
  const bytes = Number(raw)
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0
})

const showLimitPop = ref(false)
/** 用户填的数值保持字符串：中间态（空、"1."）不能被数字输入框吞掉 */
const limitInput = ref('')
const limitUnit = ref<SpeedLimitUnit>('MB')

/** 打开面板时把当前限速回填成「数值 + 单位」，用户不用自己换算 */
function syncLimitForm() {
  const { value, unit } = fromSpeedLimitBytes(currentLimitBytes.value)
  limitInput.value = value === null ? '' : String(value)
  limitUnit.value = unit
}

watch(showLimitPop, (show) => {
  if (!show) return
  syncLimitForm()
  // 打开就落在数值框上，省掉一次点击
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.limit-pop__number input')
    input?.focus()
    input?.select()
  })
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

async function applyLimit() {
  if (!connectionStore.service) {
    message.warning(t('footer.speedLimitNoEngine'))
    return
  }
  const raw = limitInput.value.trim().replace(',', '.')
  const parsed = raw === '' ? 0 : Number(raw)
  if (raw !== '' && (!Number.isFinite(parsed) || parsed <= 0)) {
    message.warning(t('footer.speedLimitInvalid'))
    return
  }
  // 留空或填 0 视为不限制，等价于关掉限速
  const bytes = toSpeedLimitBytes(parsed, limitUnit.value)
  try {
    await statsStore.setSpeedLimit(bytes)
    if (bytes > 0) {
      // formatSpeed 自带单位（2 MB/s），这里不要再补 /s
      message.success(`${t('footer.speedLimitOn')}: ${formatSpeed(bytes)}`)
    } else {
      message.success(t('footer.speedLimitOff'))
    }
    showLimitPop.value = false
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
  width: 232px;
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

.limit-pop__form {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-8);
  margin-top: var(--ds-space-12);
}

.limit-pop__row {
  display: flex;
  align-items: center;
  gap: var(--ds-space-6);
}

.limit-pop__number {
  flex: 1 1 auto;
  min-width: 0;
}

.limit-pop__units {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--ds-border-base);
  border-radius: var(--ds-radius-sm);
  background: var(--ds-bg-sunken);
}

.limit-unit {
  height: 22px;
  padding: 0 var(--ds-space-8);
  border: none;
  border-radius: calc(var(--ds-radius-sm) - 1px);
  background: transparent;
  color: var(--ds-text-muted);
  font-size: var(--ds-text-micro-size);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.limit-unit:hover {
  color: var(--ds-text-strong);
}

.limit-unit.is-active {
  background: var(--ds-bg-surface);
  color: var(--ds-text-strong);
  font-weight: 600;
}

.limit-unit:focus-visible {
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 1px;
}

@media (max-width: 900px) {
  .stat--count {
    display: none;
  }
}
</style>
