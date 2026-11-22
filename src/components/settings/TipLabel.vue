<template>
  <span class="tip-label">
    <span class="tip-label-text" :title="hintText || undefined" :aria-description="hintText || undefined">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RESTART_REQUIRED_OPTIONS } from '@/utils/aria2RestartOptions'

const props = defineProps<{
  label: string
  tip?: string
  /** aria2 选项名；若该选项需重启 Aria2 服务才生效，问号提示中会自动附加说明 */
  option?: string
}>()

const { t } = useI18n()
const requiresRestart = computed(() =>
  props.option ? RESTART_REQUIRED_OPTIONS.has(props.option) : false
)

// 说明只作为悬停/读屏的补充，不再渲染问号图标：字段靠标签与分组自解释，
// 避免每个设置项旁边都挂一个视觉噪音。
const hintText = computed(() => {
  const parts: string[] = []
  if (props.tip) parts.push(props.tip)
  if (requiresRestart.value) parts.push(t('settings.restartRequiredHint'))
  return parts.join('\n')
})
</script>

<style scoped>
.tip-label {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-space-6);
  line-height: 1.2;
}

.tip-label-text {
  color: var(--ds-text-strong);
}
</style>
