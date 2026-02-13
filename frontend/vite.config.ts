import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appVersion = process.env.APP_VERSION || process.env.VITE_APP_VERSION || 'dev'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
