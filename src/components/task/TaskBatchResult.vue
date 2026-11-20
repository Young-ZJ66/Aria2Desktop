<template>
  <UiPanel v-if="visible" class="batch-result" variant="sunken">
    <template #header>
      <h2 class="batch-result__title">{{ title ?? t('task.batchResultTitle') }}</h2>
    </template>
    <template #actions>
      <UiIconButton :icon="CloseOutline" :label="t('common.close')" size="sm" @click="emit('close')" />
    </template>

    <!-- role=status + aria-live：批量操作结束后结果可能是唯一反馈，读屏也要能读到 -->
    <div class="batch-result__stats" role="status" aria-live="polite">
      <span class="batch-result__stat batch-result__stat--success">
        {{ t('task.batchResultSuccess', { count: success }) }}
      </span>
      <span class="batch-result__stat batch-result__stat--failed">
        {{ t('task.batchResultFailed', { count: failed }) }}
      </span>
      <span class="batch-result__stat batch-result__stat--skipped">
        {{ t('task.batchResultSkipped', { count: skipped }) }}
      </span>
    </div>

    <div v-if="failures.length > 0" class="batch-result__failures">
      <p class="batch-result__failures-title">{{ t('task.batchResultFailures') }}</p>
      <ul class="batch-result__list">
        <li v-for="(item, index) in visibleFailures" :key="`${item.name}-${index}`" class="batch-result__item">
          <span class="batch-result__name" :title="item.name">{{ item.name }}</span>
          <span class="batch-result__reason">{{ item.reason }}</span>
        </li>
      </ul>
      <p v-if="hiddenCount > 0" class="batch-result__more">
        {{ t('task.batchResultMore', { count: hiddenCount }) }}
      </p>
    </div>
  </UiPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloseOutline } from '@vicons/ionicons5'
import { UiIconButton, UiPanel } from '@/components/ui'
import type { BatchFailure } from './batchResult'

/**
 * 批量操作结果面板（D-39 / D-51）。
 * 批量开始、暂停、删除三处共用：先逐项执行、失败不中断，再在这里一次性列明失败项，
 * 而不是用几条 message.error 把详情冲掉（旧实现只弹「已删除 3/8」这种没有下文的提示）。
 */
const props = defineProps<{
  visible: boolean
  title?: string
  success: number
  failed: number
  skipped: number
  failures: BatchFailure[]
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

// 面板不做滚动区：失败项过多时列表会撑长页面，截断并给出剩余数量更稳妥
const MAX_VISIBLE_FAILURES = 5
const visibleFailures = computed(() => props.failures.slice(0, MAX_VISIBLE_FAILURES))
const hiddenCount = computed(() => Math.max(0, props.failures.length - MAX_VISIBLE_FAILURES))
</script>

<style scoped>
.batch-result {
  flex: 0 0 auto;
}

.batch-result__title {
  margin: 0;
  font-size: var(--ds-text-body-size);
  font-weight: 600;
  color: var(--ds-text-base);
}

.batch-result__stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ds-space-8);
  padding-bottom: var(--ds-space-12);
}

.batch-result__stat {
  padding: 2px var(--ds-space-10);
  border-radius: var(--ds-radius-pill);
  font-size: var(--ds-text-small-size);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.batch-result__stat--success {
  color: var(--ds-status-success-text);
  background: var(--ds-status-success-subtle);
}

.batch-result__stat--failed {
  color: var(--ds-status-danger-text);
  background: var(--ds-status-danger-subtle);
}

.batch-result__stat--skipped {
  color: var(--ds-status-warning-text);
  background: var(--ds-status-warning-subtle);
}

.batch-result__failures-title {
  margin: 0 0 var(--ds-space-6);
  font-size: var(--ds-text-small-size);
  font-weight: 600;
  color: var(--ds-text-muted);
}

.batch-result__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-6);
}

.batch-result__item {
  display: flex;
  align-items: baseline;
  gap: var(--ds-space-8);
  min-width: 0;
  font-size: var(--ds-text-small-size);
}

.batch-result__name {
  flex: 0 1 auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ds-text-base);
}

.batch-result__reason {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--ds-status-danger-text);
  overflow-wrap: anywhere;
}

.batch-result__more {
  margin: var(--ds-space-6) 0 0;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-faint);
}
</style>
