import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), svelte()],
  base: mode === 'production' ? '/speedsync/' : '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}))
