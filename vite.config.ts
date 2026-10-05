import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Southwest yellow replaces Blueprint's primary blue everywhere, including the shades Blueprint hardcodes
// in its CSS (menu highlights, table selection, header-menu icons, links). Each blue step maps to a yellow
// step of similar weight; the design tokens are overridden in src/styles.css.
const BLUE_TO_YELLOW: [RegExp, string][] = [
  [/#2d72d2/gi, '#fbaa18'], // blue-3 → accent
  [/#215db0/gi, '#e0960f'], // blue-2 → hover
  [/#184a90/gi, '#c4820c'], // blue-1 → active
  [/#4c90f0/gi, '#fcb73f'], // blue-4 → lighter
  [/#8abbff/gi, '#fdc764'], // blue-5 → text on dark
  [/rgba\(45,\s*114,\s*210/gi, 'rgba(251, 170, 24'],
  [/rgba\(33,\s*93,\s*176/gi, 'rgba(224, 150, 15'],
  [/rgba\(24,\s*74,\s*144/gi, 'rgba(196, 130, 12'],
  [/rgba\(76,\s*144,\s*240/gi, 'rgba(252, 183, 63'],
  [/rgba\(138,\s*187,\s*255/gi, 'rgba(253, 199, 100'],
]

function blueprintAccent(): Plugin {
  return {
    name: 'blueprint-accent',
    enforce: 'pre',
    transform(code, id) {
      if (!/@blueprintjs\/.+\.css$/.test(id)) return null
      return BLUE_TO_YELLOW.reduce((c, [re, to]) => c.replace(re, to), code)
    },
  }
}

// Flight pages live at real paths (/flight/...), so assets must load from the site root. Builds for a
// subpath or a sandboxed preview can override this with `vite build --base=./`.
export default defineConfig({
  plugins: [blueprintAccent(), react()],
  base: '/',
})
