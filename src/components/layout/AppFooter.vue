<template>
  <footer class="app-footer">
    <div class="footer-stats">
      <span class="stat" :aria-label="`${t('footer.downloadSpeed')}: ${formatSpeed(downloadSpeedTotal)}`">
        <n-icon :size="13" class="stat__icon"><DownloadOutline /></n-icon>
        <span class="stat__value ds-tnum">{{ formatSpeed(downloadSpeedTotal) }}</span>
      </span>
      <span class="stat" :aria-label="`${t('footer.uploadSpeed')}: ${formatSpeed(globalStat.uploadSpeed)}`">
        <n-icon :size="13" class="stat__icon"><CloudUploadOutline /></n-icon>
        <span class="stat__value ds-tnum">{{ formatSpeed(globalStat.uploadSpeed) }}</span>
      </span>

      <span class="footer-sep" aria-hidden="true" />

      <span class="stat stat--count" :aria-label="`${t('footer.active')}: ${activeCountTotal}`">
        <span class="stat__label">{{ t('footer.active') }}</span>
        <span class="stat__value ds-tnum">{{ activeCountTotal }}</span>
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
              :status="limitInvalid ? 'error' : undefined"
              @keydown.enter="flushLimitNow"
              @blur="flushLimitNow"
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
                @click="selectUnit(unit)"
              >
                {{ unit }}/s
              </button>
            </div>
          </div>
          <p v-if="limitInvalid" class="limit-pop__error">{{ t('footer.speedLimitInvalid') }}</p>
        </div>
      </div>
    </n-popover>
  </footer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon, NInput, NPopover, NSwitch } from 'naive-ui'
import { useStatsStore } from '@/stores/statsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStreamTaskStore } from '@/stores/streamTaskStore'
import { formatSpeed } from '@/utils/taskFormatters'
import { DownloadOutline, CloudUploadOutline, SpeedometerOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import {
  SPEED_LIMIT_UNITS,
  fromSpeedLimitBytes,
  parseSpeedLimitInput,
  type SpeedLimitUnit
} from '@/utils/speedLimit'

const statsStore = useStatsStore()
const connectionStore = useConnectionStore()
const streamTaskStore = useStreamTaskStore()
const { t } = useI18n()

const globalStat = computed(() => statsStore.globalStat)

/**
 * 页脚速度/活动数要把流媒体任务算进来（D-10 一期）。
 *
 * yt-dlp 任务不进 aria2 队列，所以 globalStat 里永远看不到它们：
 * 用户正在下 B 站视频时页脚一直是 0 B/s、活动 0，看起来像卡死了。
 * 这里做的是"相加"，而不是替换——aria2 仍是主力，两者只是共用同一行汇总。
 */
const downloadSpeedTotal = computed(() => globalStat.value.downloadSpeed + streamTaskStore.activeSpeedBytes)
const activeCountTotal = computed(() => globalStat.value.numActive + streamTaskStore.activeCount)

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
/** 输入框里不是有效数字：不写引擎，只在面板内提示 */
const limitInvalid = ref(false)

/** 打开面板时把当前限速回填成「数值 + 单位」，用户不用自己换算 */
function syncLimitForm() {
  const { value, unit } = fromSpeedLimitBytes(currentLimitBytes.value)
  limitInput.value = value === null ? '' : String(value)
  limitUnit.value = unit
}

watch(showLimitPop, (show) => {
  if (!show) {
    clearLimitTimer()
    limitInvalid.value = false
    return
  }
  syncLimitForm()
  // 打开就落在数值框上，省掉一次点击
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.limit-pop__number input')
    input?.focus()
    input?.select()
  })
})

/**
 * 开关直接按面板里填的值生效：用户填了 10MB/s 再打开开关，没有理由还给他 1MB/s。
 * 输入框空着（或填 0）才回落到上次设定过的值；从没设过就提示先填数值。
 */
async function handleToggleSpeedLimit(value: boolean) {
  if (!connectionStore.service) {
    message.warning(t('footer.speedLimitNoEngine'))
    return
  }
  try {
    if (!value) {
      await statsStore.toggleSpeedLimit()
      message.success(t('footer.speedLimitOff'))
      return
    }
    const bytes = parseSpeedLimitInput(limitInput.value, limitUnit.value)
    if (bytes === null) {
      message.warning(t('footer.speedLimitInvalid'))
      return
    }
    if (bytes > 0) {
      await statsStore.setSpeedLimit(bytes)
      message.success(`${t('footer.speedLimitOn')}: ${formatSpeed(bytes)}`)
      return
    }
    // 没填值：恢复上次设定过的值；从没设过就提示先填，别凭空给一个 1MB/s
    const restored = await statsStore.toggleSpeedLimit()
    if (!restored) {
      message.warning(t('footer.speedLimitNeedValue'))
      nextTick(() => document.querySelector<HTMLInputElement>('.limit-pop__number input')?.focus())
      return
    }
    message.success(t('footer.speedLimitOn'))
  } catch {
    message.error(t('footer.speedLimitToggleFailed'))
  }
}

/** 输入停下来就写回引擎，不再需要点「确定」 */
const LIMIT_APPLY_DELAY = 500
let limitTimer: ReturnType<typeof setTimeout> | null = null

function clearLimitTimer() {
  if (limitTimer === null) return
  clearTimeout(limitTimer)
  limitTimer = null
}

/**
 * 把面板里的数值写回引擎。留空或填 0 视为不限制。
 * 打开面板回填、单位切回同一档位也会走到这里，值没变就不发 RPC。
 */
async function applyLimitNow() {
  if (!connectionStore.service) return
  const bytes = parseSpeedLimitInput(limitInput.value, limitUnit.value)
  limitInvalid.value = bytes === null
  if (bytes === null) return
  if (bytes === currentLimitBytes.value) return
  try {
    await statsStore.setSpeedLimit(bytes)
  } catch {
    message.error(t('footer.speedLimitToggleFailed'))
  }
}

/** 输入防抖：连打 10 不会先按 1 生效 */
function scheduleLimitApply() {
  // 校验态跟着按键即时反馈，不用等防抖结束
  limitInvalid.value = parseSpeedLimitInput(limitInput.value, limitUnit.value) === null
  clearLimitTimer()
  limitTimer = setTimeout(() => {
    limitTimer = null
    void applyLimitNow()
  }, LIMIT_APPLY_DELAY)
}

/** 回车、失焦、切换单位立刻生效，不等防抖 */
function flushLimitNow() {
  clearLimitTimer()
  void applyLimitNow()
}

function selectUnit(unit: SpeedLimitUnit) {
  if (limitUnit.value === unit) return
  limitUnit.value = unit
  flushLimitNow()
}

watch(limitInput, scheduleLimitApply)

onBeforeUnmount(clearLimitTimer)
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

.limit-pop__error {
  margin: 0;
  font-size: var(--ds-text-micro-size);
  line-height: 1.4;
  color: var(--color-danger-text);
}

@media (max-width: 900px) {
  .stat--count {
    display: none;
  }
}
</style>
