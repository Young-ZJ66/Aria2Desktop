<template>
  <header class="page-header">
    <div class="page-header__text">
      <h2 class="page-header__title">{{ title }}</h2>
      <p v-if="description" class="page-header__desc">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 16px;
  padding: 2px 2px 0;
}

.page-header__text {
  min-width: 0;
}

.page-header__title {
  margin: 0;
  font-size: 22px;
  line-height: 1.35;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.page-header__desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.page-header__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  flex: none;
  gap: 12px;
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    gap: 12px;
  }

  .page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
