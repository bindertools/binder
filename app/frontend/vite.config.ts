import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  define: {
    // Replaced at build time; Rollup tree-shakes dead branches.
    // Set VITE_PLUGINS=true when building the plugins variant.
    __PLUGINS__: process.env.VITE_PLUGINS === 'true',
  },
  resolve: {
    alias: {
      '@cmdide/plugin-sdk': path.resolve(__dirname, '../../packages/plugin-sdk'),
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
