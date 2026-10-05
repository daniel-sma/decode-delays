import type { IconName } from '@blueprintjs/icons'
import type { Cat, Reported } from './data'

// Categories are told apart by Blueprint icons and labels, not colour.
export const CAT_META: Record<Cat, { label: string; short: string; icon: IconName; blurb: string }> = {
  weather: {
    label: 'Weather',
    short: 'Weather',
    icon: 'cloud',
    blurb: 'Extreme weather, plus air-traffic delays at an airport with thunderstorms, low ceilings or strong gusts at the time.',
  },
  airspace: {
    label: 'Airspace & volume',
    short: 'Airspace',
    icon: 'antenna',
    blurb: 'Air-traffic control delays with no adverse weather on record: congestion, runway or equipment limits, staffing.',
  },
  airline: {
    label: 'Airline',
    short: 'Airline',
    icon: 'wrench',
    blurb: 'Within the airline’s control: maintenance, crew, cleaning, baggage, fueling, boarding.',
  },
  security: {
    label: 'Security',
    short: 'Security',
    icon: 'shield',
    blurb: 'Terminal evacuations, screening breaches, long security lines.',
  },
  untraced: {
    label: 'Untraced late aircraft',
    short: 'Untraced',
    icon: 'help',
    blurb: 'Inherited delay whose upstream flight has no cause breakdown (e.g. it arrived <15 min late, or the tail chain breaks).',
  },
}

export const REPORTED_META: Record<Reported, { label: string; icon: IconName }> = {
  carrier: { label: 'Carrier', icon: 'wrench' },
  weather: { label: 'Weather', icon: 'cloud' },
  nas: { label: 'NAS', icon: 'antenna' },
  security: { label: 'Security', icon: 'shield' },
  late: { label: 'Late aircraft', icon: 'history' },
}

/** Minutes relative to midnight ET of the selected day → "3:10 pm". */
export function clock(minRel: number) {
  const m = ((Math.round(minRel) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  const suffix = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  const dayShift = minRel < 0 ? ' (prev. day)' : minRel >= 1440 ? ' (+1)' : ''
  return `${h12}:${mm} ${suffix}${dayShift}`
}

export function hourLabel(h: number) {
  const hh = h % 24
  const s = hh === 0 ? '12a' : hh < 12 ? `${hh}a` : hh === 12 ? '12p' : `${hh - 12}p`
  return s
}

export function dur(min: number) {
  const m = Math.round(min)
  if (Math.abs(m) < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export function pct(part: number, whole: number) {
  return whole ? `${Math.round((100 * part) / whole)}%` : '—'
}

export function prettyDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

// Delay cost: Airlines for America's average direct aircraft operating cost per block minute for U.S.
// passenger airlines in 2025 (crew, fuel, maintenance, ownership, other; from DOT Form 41).
export const COST_PER_MIN = 98.41

/** $56.0M / $412K / $9,840 */
export function money(n: number, exact = false) {
  if (exact || Math.abs(n) < 10_000) return `$${Math.round(n).toLocaleString('en-US')}`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`
  return `$${Math.round(n / 1e3).toLocaleString('en-US')}K`
}
