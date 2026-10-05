import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built site works from any static host or subpath (GitHub Pages, Vercel, Netlify)
export default defineConfig({
  plugins: [react()],
  base: './',
})
