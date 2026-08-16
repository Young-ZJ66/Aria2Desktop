<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="t('app.settings')"
    :bordered="false"
    :mask-closable="true"
    style="width: 900px;"
    content-style="padding: 0;"
  >
    <div class="settings-dialog-body">
      <n-tabs
        v-model:value="activeTab"
        type="line"
        placement="left"
        animated
        size="medium"
        display-directive="show:lazy"
        pane-style="padding: 0 16px 0 20px;"
      >
        <n-tab-pane name="general" :tab="t('nav.generalSettings')">
          <GeneralSettings />
        </n-tab-pane>
        <n-tab-pane name="engine" :tab="t('nav.engineSettings')">
          <EngineSettings />
        </n-tab-pane>
        <n-tab-pane name="download" :tab="t('nav.downloadSettings')">
          <DownloadSettings />
        </n-tab-pane>
        <n-tab-pane name="network" :tab="t('nav.networkSettings')">
          <NetworkSettings />
        </n-tab-pane>
        <n-tab-pane name="protocol" :tab="t('nav.protocolSettings')">
          <ProtocolSettings />
        </n-tab-pane>
        <n-tab-pane name="bt" :tab="t('nav.btSettings')">
          <BtSettings />
        </n-tab-pane>
        <n-tab-pane name="metalink" :tab="t('nav.metalinkSettings')">
          <MetalinkSettings />
        </n-tab-pane>
        <n-tab-pane name="rpc-security" :tab="t('nav.rpcSecuritySettings')">
          <RpcSecuritySettings />
        </n-tab-pane>
        <n-tab-pane name="advanced" :tab="t('nav.advancedSettings')">
          <AdvancedSettings />
        </n-tab-pane>
      </n-tabs>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/uiStore'

// 设置页面按需加载，保持与原有路由懒加载一致，避免全部打进首屏包
const GeneralSettings = defineAsyncComponent(() => import('@/views/settings/GeneralSettings.vue'))
const EngineSettings = defineAsyncComponent(() => import('@/views/settings/EngineSettings.vue'))
const DownloadSettings = defineAsyncComponent(() => import('@/views/settings/DownloadSettings.vue'))
const NetworkSettings = defineAsyncComponent(() => import('@/views/settings/NetworkSettings.vue'))
const ProtocolSettings = defineAsyncComponent(() => import('@/views/settings/ProtocolSettings.vue'))
const BtSettings = defineAsyncComponent(() => import('@/views/settings/BtSettings.vue'))
const MetalinkSettings = defineAsyncComponent(() => import('@/views/settings/MetalinkSettings.vue'))
const RpcSecuritySettings = defineAsyncComponent(() => import('@/views/settings/RpcSecuritySettings.vue'))
const AdvancedSettings = defineAsyncComponent(() => import('@/views/settings/AdvancedSettings.vue'))

const uiStore = useUiStore()
const { t } = useI18n()

const activeTab = ref('general')

const visible = computed({
  get: () => uiStore.showSettings,
  set: (value: boolean) => {
    if (!value) uiStore.closeSettings()
  }
})
</script>

<style scoped>
.settings-dialog-body {
  height: 70vh;
  max-height: 70vh;
  overflow: hidden;
  padding: 4px 0 16px 16px;
  display: flex;
  flex-direction: column;
}

/* 左侧标签栏固定不动，仅右侧内容区独立滚动 */
.settings-dialog-body :deep(.n-tabs) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.settings-dialog-body :deep(.n-tabs .n-tab-pane) {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>