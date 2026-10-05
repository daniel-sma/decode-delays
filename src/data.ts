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

/** Total minutes for an airport by category, for one hour or the whole day. */
export function airportByCat(a: Airport, mode: 'origin' | 'felt', hour: number | null): number[] {
  const src = a[mode]
  return src.map((row) => (hour == null ? sum(row) : row[hour] ?? 0))
}

export function flightLabel(day: Day, i: number) {
  return `${day.flights.carrier[i]} ${day.flights.fn[i]}`
}

export function route(day: Day, i: number) {
  return `${day.airports[day.flights.o[i]].code} → ${day.airports[day.flights.d[i]].code}`
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

export function reportedForArrivals(day: Day, airport: number): number[] {
  const out = REPORTED.map(() => 0)
  const f = day.flights
  for (let i = 0; i < f.d.length; i++) {
    if (f.d[i] !== airport || f.otherDay[i] || !f.causes[i]) continue
    f.causes[i]!.forEach((v, k) => (out[k] += v))
  }
  return out
}

export function decodedForArrivals(day: Day, airport: number): number[] {
  return day.airports[airport].felt.map(sum)
}

/** Search by flight number ("DL 1234", "dl1234", "1234") or tail ("N123"). */
export function searchFlights(day: Day, q: string, limit = 8): number[] {
  const s = q.trim().toUpperCase().replace(/\s+/g, '')
  if (s.length < 2) return []
  const f = day.flights
  const hits: number[] = []
  for (let i = 0; i < f.fn.length && hits.length < 200; i++) {
    if (f.otherDay[i]) continue
    const label = f.carrier[i] + f.fn[i]
    if (label === s || f.fn[i] === s || f.tail[i].toUpperCase().startsWith(s) || label.startsWith(s)) hits.push(i)
  }
  // Most-delayed first — those are the interesting ones.
  return hits.sort((a, b) => (f.arrDelay[b] ?? -1) - (f.arrDelay[a] ?? -1)).slice(0, limit)
}
