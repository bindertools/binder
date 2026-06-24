import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@binder/app-sdk': path.resolve(__dirname, '../../packages/plugin-sdk'),
    },
  },
  server: {
    fs: {
      // Allow Vite's dev server to serve files from outside the frontend root
      allow: ['..', '../..', '../../packages'],
    },
  },
  build: {
    chunkSizeWarningLimit: 5000,
  },
})