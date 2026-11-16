<template>
  <div class="ui-stat" :class="[`ui-stat--${tone}`]">
    <span class="ui-stat__label">{{ label }}</span>
    <span class="ui-stat__value ds-tnum">
      {{ value }}<span v-if="unit" class="ui-stat__unit">{{ unit }}</span>
    </span>
    <span v-if="hint" class="ui-stat__hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 指标块：label 小字在上、数值大字在下，数值统一等宽数字。
 * v1 的 5 个大数字是散在卡片里的裸 n-statistic，字号/对齐/单位各不相同。
 */
withDefaults(
  defineProps<{
    label: string
    value: string | number
    unit?: string
    hint?: string
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  }>(),
  { tone: 'neutral' }
)
</script>

<style scoped>
.ui-stat {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-2);
  min-width: 0;
}

.ui-stat__label {
  font-size: var(--ds-text-micro-size);
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ds-text-muted);
}

.ui-stat__value {
  font-size: var(--ds-text-display-size);
  line-height: var(--ds-text-display-leading);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--ds-text-strong);
}

.ui-stat__unit {
  margin-left: 2px;
  font-size: var(--ds-text-small-size);
  font-weight: 500;
  color: var(--ds-text-muted);
}

.ui-stat__hint {
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

.ui-stat--accent .ui-stat__value {
  color: var(--ds-accent-text);
}

.ui-stat--success .ui-stat__value {
  color: var(--ds-status-success-text);
}

.ui-stat--warning .ui-stat__value {
  color: var(--ds-status-warning-text);
}

.ui-stat--danger .ui-stat__value {
  color: var(--ds-status-danger-text);
}
</style>
