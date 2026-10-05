import { useHotkeys, type HotkeyConfig } from '@blueprintjs/core'

/**
 * Registers Blueprint hotkeys (so `?` lists them) from a component that renders nothing. useHotkeys
 * subscribes to the hotkeys registry, and in the component that owns a big view that subscription
 * re-rendered the whole view on every registry update: with the delays table it looped until React gave up.
 */
export default function Hotkeys({ config }: { config: HotkeyConfig[] }) {
  useHotkeys(config)
  return null
}
