import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split Monaco into its own chunk to keep the main bundle small
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
        },
      },
    },
    // Monaco workers are large; raise the warning threshold
    chunkSizeWarningLimit: 5000,
  },
})
