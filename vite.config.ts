import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    // NotesTool 走 lazy() 边界，预打包可避免首次进入笔记页触发依赖发现 → 整页 reload。
    // shiki 只列用到的那几个子路径：`shiki/langs` 带着 242 个动态 import，
    // 交给预打包代价过大，让它留在按需加载那条路上。
    include: [
      'cherry-markdown',
      '@milkdown/kit',
      '@milkdown/plugin-highlight',
      'shiki/core',
      'shiki/themes',
      'shiki/engine/javascript',
    ]
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/cherry-markdown/, /node_modules/]
    }
  },
  server: {
    proxy: {
      '/api/gtx-translate-html': {
        target: 'https://translate-pa.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gtx-translate-html/, '/v1/translateHtml'),
      },
      '/api/gtx-element-html': {
        target: 'https://translate.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gtx-element-html/, '/translate_a/elementHtml'),
      },
      '/api/gtx-single': {
        target: 'https://translate.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gtx-single/, '/translate_a/single'),
      },
    },
  },
})
