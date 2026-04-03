import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'workers/billing.worker': resolve('src/main/workers/billing.worker.ts'),
          'workers/import.worker': resolve('src/main/workers/import.worker.ts'),
          'workers/pdf.worker': resolve('src/main/workers/pdf.worker.ts'),
          'workers/report-export.worker': resolve('src/main/workers/report-export.worker.ts')
        },
        output: {
          entryFileNames: '[name].js'
        },
        external: ['better-sqlite3']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@preload': resolve('src/preload')
      }
    },
    plugins: [react()]
  }
})
