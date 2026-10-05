import type { Cat, Reported } from './data'

// Dark-mode categorical slots, validated all-pairs for the map (see README → Colour).
export const COLOR = {
  blue: '#3987e5',
  orange: '#d95926',
  aqua: '#199e70',
  violet: '#9085e9',
  gray: '#898781',
}

export const CAT_META: Record<Cat, { label: string; short: string; color: string; blurb: string }> = {
  weather: {
    label: 'Weather',
    short: 'Weather',
    color: COLOR.blue,
    blurb: 'Extreme weather, plus air-traffic delays at an airport with thunderstorms, low ceilings or strong gusts at the time.',
  },
  airspace: {
    label: 'Airspace & volume',
    short: 'Airspace',
    color: COLOR.aqua,
    blurb: 'Air-traffic control delays with no adverse weather on record: congestion, runway or equipment limits, staffing.',
  },
  airline: {
    label: 'Airline',
    short: 'Airline',
    color: COLOR.orange,
    blurb: 'Within the airline’s control: maintenance, crew, cleaning, baggage, fueling, boarding.',
  },
  security: {
    label: 'Security',
    short: 'Security',
    color: COLOR.violet,
    blurb: 'Terminal evacuations, screening breaches, long security lines.',
  },
  untraced: {
    label: 'Untraced late aircraft',
    short: 'Untraced',
    color: COLOR.gray,
    blurb: 'Inherited delay whose upstream flight has no cause breakdown (e.g. it arrived <15 min late, or the tail chain breaks).',
  },
}

export const REPORTED_META: Record<Reported, { label: string; color: string; hatch?: boolean }> = {
  carrier: { label: 'Carrier', color: COLOR.orange },
  weather: { label: 'Weather', color: COLOR.blue },
  nas: { label: 'NAS', color: COLOR.aqua },
  security: { label: 'Security', color: COLOR.violet },
  late: { label: 'Late aircraft', color: COLOR.gray, hatch: true },
}

export function hexToRgb(hex: string, alpha = 255): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
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
