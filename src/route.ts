// URL routing without a router library: "/" is the delays table, a flight is
// "/flight/<date>/<carrier><number>/<origin>-<destination>" (e.g. /flight/2026-07-28/WN4067/VPS-BWI).
// Origin and destination are part of the path because a flight number can fly several legs in a day.

import type { Day } from './data'

export type Route =
  | { kind: 'home' }
  | { kind: 'flight'; date: string; flight: string; o: string; d: string }

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') // '' when the app is served from the root

export function flightPath(day: Day, i: number) {
  const f = day.flights
  return `${BASE}/flight/${day.date}/${f.carrier[i]}${f.fn[i]}/${day.airports[f.o[i]].code}-${day.airports[f.d[i]].code}`
}

export function parsePath(pathname: string): Route {
  const p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname
  const m = p.match(/^\/flight\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9]+)\/([A-Za-z]{3})-([A-Za-z]{3})\/?$/)
  if (!m) return { kind: 'home' }
  return { kind: 'flight', date: m[1], flight: m[2].toUpperCase(), o: m[3].toUpperCase(), d: m[4].toUpperCase() }
}

/** The flight on this day matching a route, or -1. Prefers flights departing that day over spill-ins. */
export function findFlight(day: Day, r: Route): number {
  if (r.kind !== 'flight' || r.date !== day.date) return -1
  const f = day.flights
  let fallback = -1
  for (let i = 0; i < f.fn.length; i++) {
    if (f.carrier[i] + f.fn[i] !== r.flight) continue
    if (day.airports[f.o[i]].code !== r.o || day.airports[f.d[i]].code !== r.d) continue
    if (!f.otherDay[i]) return i
    fallback = i
  }
  return fallback
}

/** Push (or replace) a history entry; sandboxed frames may refuse, which is harmless. */
export function go(path: string, replace = false) {
  try {
    if (path === location.pathname) return
    if (replace) history.replaceState(null, '', path)
    else history.pushState(null, '', path)
  } catch { /* ignore */ }
}

export const homePath = () => `${BASE}/`
