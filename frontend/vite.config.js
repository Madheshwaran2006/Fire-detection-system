import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/stream':       { target: apiBase, changeOrigin: true },
        '/camera':       { target: apiBase, changeOrigin: true },
        '/live':         { target: apiBase, changeOrigin: true },
        '/api':          { target: apiBase, changeOrigin: true },
        '/health':       { target: apiBase, changeOrigin: true },
      },
    },
  }
})
