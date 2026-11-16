<template>
  <section
    class="ui-panel"
    :class="[`ui-panel--${variant}`, { 'ui-panel--flush': flush, 'ui-panel--divided': divided }]"
  >
    <header v-if="title || $slots.header || $slots.actions" class="ui-panel__header">
      <div class="ui-panel__heading">
        <slot name="header">
          <h2 v-if="title" class="ui-panel__title">{{ title }}</h2>
          <p v-if="hint" class="ui-panel__hint">{{ hint }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="ui-panel__actions">
        <slot name="actions" />
      </div>
    </header>

    <div class="ui-panel__body" :class="{ 'ui-panel__body--flush': flush }">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="ui-panel__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup lang="ts">
/**
 * 面板：v2 里唯一的「表面」原语。
 *
 * v1 的卡片是 n-card 到处包一层——同一屏能出现 6 个带阴影的白块，层级全被抹平。
 * v2 只保留一种表面：1px 描边 + 无阴影（阴影只属于浮层）。分组靠留白与分隔线，
 * 而不是靠「再加一个盒子」。
 */
withDefaults(
  defineProps<{
    title?: string
    hint?: string
    /** surface=常规面板；sunken=嵌入区；ghost=无背景（用于页面级分组） */
    variant?: 'surface' | 'sunken' | 'ghost'
    /** 主体去掉内边距（表格、列表这类自带留白的子元素用） */
    flush?: boolean
    /** 头部下方加一条分隔线 */
    divided?: boolean
  }>(),
  { variant: 'surface', flush: false, divided: false }
)
</script>

<style scoped>
.ui-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: var(--ds-radius-lg);
  border: 1px solid var(--ds-border-subtle);
  background: var(--ds-bg-surface);
  overflow: hidden;
}

.ui-panel--sunken {
  background: var(--ds-bg-sunken);
  border-color: transparent;
}

.ui-panel--ghost {
  background: transparent;
  border-color: transparent;
}

.ui-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ds-space-16);
  padding: var(--ds-space-16) var(--ds-space-20) var(--ds-space-12);
  border-bottom: 1px solid transparent;
}

.ui-panel--divided .ui-panel__header {
  border-bottom-color: var(--ds-border-subtle);
  padding-bottom: var(--ds-space-12);
}

.ui-panel__heading {
  min-width: 0;
}

.ui-panel__title {
  margin: 0;
  font-size: var(--ds-text-title-size);
  line-height: var(--ds-text-title-leading);
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ds-text-strong);
}

.ui-panel__hint {
  margin: var(--ds-space-4) 0 0;
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-muted);
}

.ui-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  flex: none;
}

.ui-panel__body {
  flex: 1;
  min-height: 0;
  padding: 0 var(--ds-space-20) var(--ds-space-20);
}

.ui-panel__body--flush {
  padding: 0;
}

.ui-panel__footer {
  padding: var(--ds-space-12) var(--ds-space-20);
  border-top: 1px solid var(--ds-border-subtle);
  background: var(--ds-bg-sunken);
}
</style>
