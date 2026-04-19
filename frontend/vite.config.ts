import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), cloudflare()],
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(env.VITE_API_BASE),
    },
  };
})