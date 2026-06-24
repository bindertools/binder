import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@binder/app-sdk': path.resolve(__dirname, '../../packages/plugin-sdk'),
      // App packages live outside this project root (../../packages/<id>), so
      // bare npm imports there can fail to resolve up through node_modules.
      // Pin the shared deps they use to this project's copies explicitly.
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react': path.resolve(__dirname, 'node_modules/react'),
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
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