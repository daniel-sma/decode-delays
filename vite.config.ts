import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Flight pages live at real paths (/flight/...), so assets must load from the site root. Builds for a
// subpath or a sandboxed preview can override this with `vite build --base=./`.
export default defineConfig({
  plugins: [react()],
  base: '/',
})
