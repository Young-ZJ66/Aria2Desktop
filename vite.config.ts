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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Element Plus 单独拆分
            {
              name: 'element-plus',
              test: /node_modules[\\/]*element-plus/,
              priority: 20
            },
            // Vue 生态（vue、vue-router、pinia、vue-i18n）单独拆分
            {
              name: 'vue-vendor',
              test: /node_modules[\\/]*(@vue|vue|vue-router|pinia|@intlify)[\\/]/,
              priority: 15
            },
            // ECharts 单独拆分
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
    host: '0.0.0.0'
  }
})
