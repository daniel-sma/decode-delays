import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The accent is a muted blue (#3F6FAE) instead of Blueprint's brighter primary blue, including the shades Blueprint
// hardcodes in its CSS (menu highlights, table selection, header menus, focus rings, links). Each blue step
// maps to a muted step of similar weight; the design tokens are overridden in src/styles.css.
const BLUE_TO_ACCENT: [RegExp, string][] = [
  [/#2d72d2/gi, '#3f6fae'], // blue-3 → accent
  [/#215db0/gi, '#36609a'], // blue-2 → hover
  [/#184a90/gi, '#2e5285'], // blue-1 → active
  [/#4c90f0/gi, '#5a87c2'], // blue-4 → accent-light
  [/#8abbff/gi, '#8aaedd'], // blue-5 → text on dark
  [/rgba\(45,\s*114,\s*210/gi, 'rgba(63, 111, 174'],
  [/rgba\(33,\s*93,\s*176/gi, 'rgba(54, 96, 154'],
  [/rgba\(24,\s*74,\s*144/gi, 'rgba(46, 82, 133'],
  [/rgba\(76,\s*144,\s*240/gi, 'rgba(90, 135, 194'],
  [/rgba\(138,\s*187,\s*255/gi, 'rgba(138, 174, 221'],
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
