// Shapes of the JSON written by pipeline/build_data.py, plus helpers to read them.

export type Cat = 'weather' | 'airspace' | 'airline' | 'security' | 'untraced'
export type Reported = 'carrier' | 'weather' | 'nas' | 'security' | 'late'

export const CATS: Cat[] = ['weather', 'airspace', 'airline', 'security', 'untraced']
export const REPORTED: Reported[] = ['carrier', 'weather', 'nas', 'security', 'late']

export interface DaySummary {
  date: string
  flights: number
  delayed: number
  cancelled: number
  reported: Record<Reported, number>
  decoded: Record<Cat, number>
}

export interface Summary {
  synthetic: boolean
  source: string
  generatedAt: string
  month: string
  availableDays: string[]
  trace: { lateMinutes: number; lateTraced: number; chainBreaks: number }
  stats: { flights: number; tails: number; wxAirports: number }
  days: DaySummary[]
}

export interface Airport {
  code: string
  name: string
  city: string
  lat: number
  lon: number
  deps: number[]
  delayedDeps: number[]
  cancelled: number[]
  /** [cat][hour] minutes of delay that landed here (arrival delay), by decoded root cause */
  felt: number[][]
  /** [cat][hour] minutes of delay whose root cause happened here */
  origin: number[][]
  /** [hour] root-cause minutes here that were felt at a different airport */
  exported: number[]
}

/** [cat index, airport index, root flight index, root minute (rel. day start), hops, minutes] */
export type Contribution = [number, number, number, number, number, number]

export interface FlightCols {
  carrier: string[]
  fn: string[]
  tail: string[]
  o: number[]
  d: number[]
  sdep: number[]
  sarr: number[]
  depDelay: (number | null)[]
  arrDelay: (number | null)[]
  /** '' normal, 'C<code>' cancelled, 'D' diverted */
  status: string[]
  causes: (number[] | null)[]
  decoded: Contribution[][]
  prev: (number | null)[]
  otherDay: number[]
}

/** [source airport, target airport, hour felt, cat, minutes, flight indices] */
export type Arc = [number, number, number, number, number, number[]]

export interface Day {
  date: string
  dayStartUtcMin: number
  hours: number
  airports: Airport[]
  flights: FlightCols
  arcs: Arc[]
  /** per airport, per hour: [thunderstorm, IFR, gust kt, raw METAR] or null */
  weather: Record<string, ([number, number, number, string] | null)[]>
  totals: {
    flights: number
    cancelled: Record<string, number>
    reported: Record<Reported, number>
    decoded: Record<Cat, number>
  }
}

const base = import.meta.env.BASE_URL

export async function loadSummary(): Promise<Summary | null> {
  const r = await fetch(`${base}data/summary.json`)
  if (!r.ok) return null
  try {
    return await r.json()
  } catch {
    return null // dev server returns index.html for missing files
  }
}

export async function loadDay(date: string): Promise<Day> {
  const r = await fetch(`${base}data/day-${date}.json`)
  return r.json()
}

// ---------------------------------------------------------------- derived helpers

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** "WN 4067", or '' when the flight isn't in the data (e.g. a root cause on a day that wasn't exported). */
export function flightLabel(day: Day, i: number) {
  const f = day.flights
  return f.carrier[i] != null && f.fn[i] != null ? `${f.carrier[i]} ${f.fn[i]}` : ''
}

/** "VPS → BWI", or '' when unknown. */
export function route(day: Day, i: number) {
  const o = day.airports[day.flights.o[i]]?.code, d = day.airports[day.flights.d[i]]?.code
  return o && d ? `${o} → ${d}` : ''
}

/** All flights flown by the same tail, in order. */
export function tailChain(day: Day, i: number): number[] {
  const tail = day.flights.tail[i]
  if (!tail) return [i]
  const idx: number[] = []
  day.flights.tail.forEach((t, k) => t === tail && idx.push(k))
  return idx.sort((a, b) => day.flights.sdep[a] - day.flights.sdep[b])
}

/** Decoded minutes for one flight, summed by category. */
export function decodedByCat(contribs: Contribution[]) {
  const out = CATS.map(() => 0)
  for (const c of contribs) out[c[0]] += c[5]
  return out
}


export interface Root {
  cat: number
  airport: number
  /** legs back along the tail chain (0 = this flight) */
  hops: number
  minutes: number
  /** share of the flight's cause-coded delay */
  share: number
}

/** The single biggest root cause of a flight's delay, grouped by (category, airport). */
export function rootOf(day: Day, i: number): Root | null {
  const cs = day.flights.decoded[i]
  if (!cs.length) return null
  const m = new Map<string, Root>()
  let total = 0
  for (const [cat, ap, , , hops, min] of cs) {
    total += min
    const k = `${cat}:${ap}`
    const r = m.get(k)
    if (r) {
      r.minutes += min
      r.hops = Math.max(r.hops, hops)
    } else m.set(k, { cat, airport: ap, hops, minutes: min, share: 0 })
  }
  const best = [...m.values()].sort((a, b) => b.minutes - a.minutes)[0]
  best.share = total ? best.minutes / total : 0
  return best
}

/** The reported BTS cause with the most minutes, e.g. ['late', 0.67]. */
export function topReported(day: Day, i: number): [Reported, number] | null {
  const c = day.flights.causes[i]
  if (!c) return null
  const total = sum(c)
  const k = c.indexOf(Math.max(...c))
  return total ? [REPORTED[k], c[k] / total] : null
}

/** Flights for the home table: biggest arrival delays, or one tail's day when a tail is searched. */
export function delayRows(day: Day, q: string, limit = 300): { rows: number[]; tails: string[] } {
  const f = day.flights
  const s = q.trim().toUpperCase().replace(/\s+/g, '')
  const idx: number[] = []
  for (let i = 0; i < f.fn.length; i++) {
    if (f.otherDay[i]) continue
    if (!s) {
      if ((f.arrDelay[i] ?? 0) >= 15) idx.push(i)
    } else if (f.tail[i].toUpperCase().startsWith(s) || (f.carrier[i] + f.fn[i]) === s) idx.push(i)
  }
  const tails = [...new Set(idx.map((i) => f.tail[i]))]
  // A single matching tail reads best as its day in order; otherwise worst first.
  if (s && tails.length === 1) idx.sort((a, b) => f.sdep[a] - f.sdep[b])
  else idx.sort((a, b) => (f.arrDelay[b] ?? -1) - (f.arrDelay[a] ?? -1))
  return { rows: idx.slice(0, limit), tails }
}

export function pctTraced(s: Summary) {
  return s.trace.lateMinutes ? `${Math.round((100 * s.trace.lateTraced) / s.trace.lateMinutes)}%` : '—'
}
