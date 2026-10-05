import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The accent is a muted purple (#8067B7) instead of Blueprint's primary blue, including the shades Blueprint
// hardcodes in its CSS (menu highlights, table selection, header menus, focus rings, links). Each blue step
// maps to a purple step of similar weight; the design tokens are overridden in src/styles.css.
const BLUE_TO_ACCENT: [RegExp, string][] = [
  [/#2d72d2/gi, '#8067b7'], // blue-3 → accent
  [/#215db0/gi, '#6f58a3'], // blue-2 → hover
  [/#184a90/gi, '#5e4a8c'], // blue-1 → active
  [/#4c90f0/gi, '#a48bd0'], // blue-4 → accent-light
  [/#8abbff/gi, '#bfaee0'], // blue-5 → text on dark
  [/rgba\(45,\s*114,\s*210/gi, 'rgba(128, 103, 183'],
  [/rgba\(33,\s*93,\s*176/gi, 'rgba(111, 88, 163'],
  [/rgba\(24,\s*74,\s*144/gi, 'rgba(94, 74, 140'],
  [/rgba\(76,\s*144,\s*240/gi, 'rgba(164, 139, 208'],
  [/rgba\(138,\s*187,\s*255/gi, 'rgba(191, 174, 224'],
]

function blueprintAccent(): Plugin {
  return {
    name: 'blueprint-accent',
    enforce: 'pre',
    transform(code, id) {
      if (!/@blueprintjs\/.+\.css$/.test(id)) return null
      return BLUE_TO_ACCENT.reduce((c, [re, to]) => c.replace(re, to), code)
    },
  }
}

// Flight pages live at real paths (/flight/...), so assets must load from the site root. Builds for a
// subpath or a sandboxed preview can override this with `vite build --base=./`.
export default defineConfig({
  plugins: [blueprintAccent(), react()],
  base: '/',
})
