<template>
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">{{ title }}</h1>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<style scoped>
/* 页面间距由父容器的 flex gap 统一控制，PageHeader 自身不携带外边距 */
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--ds-space-24);
}

.page-header__text {
  min-width: 0;
}

/* 页面主标题：v2 里 h1 降到 20px/600——v1 的 22px/650 比面板标题（18px）只大一点，
   层级靠字号挤不出来，改用「标题小、正文稳、留白大」的比例关系。 */
.page-header__title {
  margin: 0;
  font-size: var(--ds-text-h1-size);
  line-height: var(--ds-text-h1-leading);
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--ds-text-strong);
}

.page-header__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex: none;
  gap: var(--ds-space-8);
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--ds-space-12);
  }

  .page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
