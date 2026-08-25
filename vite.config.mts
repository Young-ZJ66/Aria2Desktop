import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    // Naive UI 按需引入：自动解析模板中的 n-* 组件并注入 import，替代全量 app.use(naive)
    Components({
      dts: 'src/components.d.ts',
      resolvers: [NaiveUiResolver()]
    })
  ],
  base: './',
  assetsInclude: ['**/*.ico'],
  build: {
    outDir: 'dist/vue',
    emptyOutDir: true,
    // naive-ui / echarts 为按需使用的全量库，gzip 后体积可接受，调高阈值消除噪音告警
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Vue 生态（vue、vue-router、pinia、vue-i18n）单独拆分
            {
              name: 'vue-vendor',
              test: /node_modules[\\/]*(@vue|vue|vue-router|pinia|@intlify)[\\/]/,
              priority: 15
            },
            // ECharts 单独拆分（已按需引入 core + 折线图，利于长期缓存）
            {
              name: 'echarts',
              test: /node_modules[\\/]*echarts/,
              priority: 15
            },
            // Naive UI 单独拆分（独立 chunk 利于缓存）
            {
              name: 'naive-ui',
              test: /node_modules[\\/]naive-ui/,
              priority: 20
            }
          ]
        }
      }
    }
  },
  // 预构建依赖，加速冷启动并固定依赖版本（dayjs 已被 vue-echarts 内部依赖解析，无需显式预构建）
  optimizeDeps: {
    include: ['vue', 'vue-router', 'pinia', 'vue-i18n', 'naive-ui', 'echarts', 'axios']
  },
  resolve: {
    alias: {
      // .mts 为 ESM，无 __dirname，用 import.meta.dirname（Node >= 20.11）
      '@': resolve(import.meta.dirname, 'src')
    }
  },
  server: {
    port: 5173,
    host: 'localhost'
  }
})