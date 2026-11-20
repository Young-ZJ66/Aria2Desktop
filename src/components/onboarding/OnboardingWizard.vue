<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="t('onboarding.title')"
    style="width: 560px"
    :bordered="false"
    :mask-closable="false"
    :closable="false"
  >
    <div class="onboarding">
      <p class="onboarding__subtitle">{{ t('onboarding.subtitle') }}</p>
      <div class="onboarding__progress">
        {{ t('onboarding.stepOf', { current: stepIndex + 1, total: steps.length }) }}
      </div>

      <div class="onboarding__card">
        <div class="onboarding__head">
          <span class="onboarding__title">{{ t(currentStep.titleKey) }}</span>
          <n-tag size="small" :bordered="false" round :type="currentStatus.type">
            {{ t(currentStatus.textKey) }}
          </n-tag>
        </div>
        <p class="onboarding__desc">{{ t(currentStep.descKey) }}</p>
        <n-button size="small" type="primary" secondary @click="openStepSettings">
          {{ t(currentStep.actionKey) }}
        </n-button>
      </div>

      <!-- 步骤小圆点：让用户知道还剩几步，也允许直接跳回已看过的步骤 -->
      <div class="onboarding__dots" role="tablist">
        <button
          v-for="(step, index) in steps"
          :key="step.id"
          type="button"
          role="tab"
          class="onboarding__dot"
          :class="{ 'onboarding__dot--active': index === stepIndex }"
          :aria-selected="index === stepIndex"
          :aria-label="t(step.titleKey)"
          @click="stepIndex = index"
        />
      </div>
    </div>

    <template #footer>
      <div class="onboarding__footer">
        <n-button quaternary size="small" @click="skipAll">
          {{ t('onboarding.skip') }}
        </n-button>
        <div class="onboarding__footer-actions">
          <n-button v-if="stepIndex > 0" size="small" @click="goBack">
            {{ t('onboarding.back') }}
          </n-button>
          <n-button v-if="!isLastStep" size="small" @click="deferStep">
            {{ t('onboarding.later') }}
          </n-button>
          <n-button v-if="!isLastStep" size="small" type="primary" @click="goNext">
            {{ t('onboarding.next') }}
          </n-button>
          <n-button v-else size="small" type="primary" @click="finish">
            {{ t('onboarding.finish') }}
          </n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useComponentStore } from '@/stores/componentStore'
import {
  completeOnboarding,
  createInitialState,
  handleStep,
  isAllStepsHandled,
  loadOnboardingState,
  saveOnboardingState,
  shouldShowOnboarding,
  skipOnboarding,
  type OnboardingState,
  type OnboardingStepId
} from '@/components/onboarding/onboardingState'

interface WizardStep {
  id: OnboardingStepId
  titleKey: string
  descKey: string
  actionKey: string
  /** 点「操作」按钮时打开哪个设置页 */
  settingsTab: string
}

/**
 * 四步顺序与文案一一对应：下载目录 → 扩展配对 → yt-dlp → 远程访问/完成规则。
 * 每一步都能「稍后再说」，不做强制拦截——首次启动被强制走完流程是最招人烦的引导。
 */
const steps: WizardStep[] = [
  {
    id: 'download',
    titleKey: 'onboarding.stepDownloadTitle',
    descKey: 'onboarding.stepDownloadDesc',
    actionKey: 'onboarding.stepDownloadAction',
    settingsTab: 'download'
  },
  {
    id: 'extension',
    titleKey: 'onboarding.stepExtensionTitle',
    descKey: 'onboarding.stepExtensionDesc',
    actionKey: 'onboarding.stepExtensionAction',
    settingsTab: 'components'
  },
  {
    id: 'ytdlp',
    titleKey: 'onboarding.stepYtdlpTitle',
    descKey: 'onboarding.stepYtdlpDesc',
    actionKey: 'onboarding.stepYtdlpAction',
    settingsTab: 'components'
  },
  {
    id: 'remote',
    titleKey: 'onboarding.stepRemoteTitle',
    descKey: 'onboarding.stepRemoteDesc',
    actionKey: 'onboarding.stepRemoteAction',
    settingsTab: 'remote-access'
  }
]

const { t } = useI18n()
const uiStore = useUiStore()
const settingsStore = useSettingsStore()
const componentStore = useComponentStore()

const visible = ref(false)
const stepIndex = ref(0)
const state = ref<OnboardingState>(createInitialState())
/** 扩展最近一次配对时间：null 表示装好应用后还没被扩展调用过 */
const extensionLastSeenAt = ref<number | null>(null)

const currentStep = computed<WizardStep>(
  () => steps[Math.min(stepIndex.value, steps.length - 1)] ?? (steps[0] as WizardStep)
)
const isLastStep = computed(() => stepIndex.value >= steps.length - 1)

/** 每步的「已就绪 / 未配置」判定，尽量用已有状态，不额外发请求 */
const stepStatus = computed<Record<OnboardingStepId, boolean>>(() => ({
  download: Boolean(settingsStore.downloadConfig?.defaultDir?.trim()),
  extension: extensionLastSeenAt.value !== null,
  ytdlp: componentStore.ytdlp.available,
  remote: settingsStore.settings.webConsole?.enabled === true
}))

const currentStatus = computed(() => {
  const ready = stepStatus.value[currentStep.value.id]
  return {
    type: (ready ? 'success' : 'default') as 'success' | 'default',
    textKey: ready ? 'onboarding.statusReady' : 'onboarding.statusPending'
  }
})

function persist(next: OnboardingState): void {
  state.value = next
  saveOnboardingState(globalThis.localStorage, next)
}

function close(): void {
  visible.value = false
}

/** 标记当前步已处理并前进；全部处理完自动完成 */
function markCurrentHandled(): boolean {
  persist(handleStep(state.value, currentStep.value.id))
  if (isAllStepsHandled(state.value)) {
    persist(completeOnboarding(state.value))
    return true
  }
  return false
}

function goNext(): void {
  if (markCurrentHandled()) {
    close()
    return
  }
  stepIndex.value = Math.min(stepIndex.value + 1, steps.length - 1)
}

function deferStep(): void {
  goNext()
}

function goBack(): void {
  stepIndex.value = Math.max(stepIndex.value - 1, 0)
}

function skipAll(): void {
  persist(skipOnboarding(state.value))
  close()
}

function finish(): void {
  markCurrentHandled()
  persist(completeOnboarding(state.value))
  close()
}

/** 跳到对应设置页：向导本身不复制设置表单，避免两处实现漂移 */
function openStepSettings(): void {
  markCurrentHandled()
  close()
  uiStore.openSettings(currentStep.value.settingsTab)
}

async function refreshExtensionStatus(): Promise<void> {
  const api = window.electronAPI
  if (!api?.getExtensionStatus) return
  try {
    const snapshot = await api.getExtensionStatus()
    extensionLastSeenAt.value = snapshot.connection.lastSeenAt ?? null
  } catch {
    extensionLastSeenAt.value = null
  }
}

onMounted(() => {
  state.value = loadOnboardingState(globalThis.localStorage)
  if (!shouldShowOnboarding(state.value)) return
  // 只在真正需要时检测组件：避免每次启动都拉一次 yt-dlp 版本
  void componentStore.checkYtdlp()
  void refreshExtensionStatus()
  visible.value = true
})

defineExpose({ steps, visible })
</script>

<style scoped>
.onboarding {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-12);
}

.onboarding__subtitle {
  margin: 0;
  color: var(--ds-text-muted);
  font-size: var(--ds-text-body-size);
  line-height: 1.6;
}

.onboarding__progress {
  font-size: var(--ds-text-micro-size);
  color: var(--ds-text-faint);
  font-variant-numeric: tabular-nums;
}

.onboarding__card {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-8);
  padding: var(--ds-space-12);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  background: var(--ds-bg-sunken);
}

.onboarding__head {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
}

.onboarding__title {
  font-size: var(--ds-text-title-size);
  font-weight: 600;
  color: var(--ds-text-strong);
}

.onboarding__desc {
  margin: 0;
  color: var(--ds-text);
  font-size: var(--ds-text-body-size);
  line-height: 1.6;
}

.onboarding__dots {
  display: flex;
  align-items: center;
  gap: var(--ds-space-6);
}

.onboarding__dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border: none;
  border-radius: var(--ds-radius-pill);
  background: var(--ds-border);
  cursor: pointer;
  transition: background 0.15s ease, width 0.15s ease;
}

.onboarding__dot--active {
  width: 18px;
  background: var(--ds-accent);
}

.onboarding__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-8);
}

.onboarding__footer-actions {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
}
</style>
