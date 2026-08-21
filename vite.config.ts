import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
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
            }
          ]
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    host: 'localhost'
  }
})
