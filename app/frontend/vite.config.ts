import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cmdide/plugin-sdk':      path.resolve(__dirname, '../../packages/plugin-sdk'),
      '@cmdide/plugin-notepad':  path.resolve(__dirname, '../../packages/plugin-notepad'),
      '@cmdide/plugin-git':      path.resolve(__dirname, '../../packages/plugin-git'),
    },
  },
  server: {
    fs: {
      // Allow Vite's dev server to serve files from outside the frontend root
      allow: ['..', '../..', '../../packages'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
        },
      },
    },
    chunkSizeWarningLimit: 5000,
  },
})
