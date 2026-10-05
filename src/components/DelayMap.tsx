import { useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { ArcLayer, GeoJsonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import statesTopo from 'us-atlas/states-10m.json'
import { airportByCat, CATS, sum, type Arc, type Day } from '../data'
import { CAT_META, dur, hexToRgb, hourLabel } from '../theme'
import type { Selection } from '../App'

const topo = statesTopo as unknown as Topology
const states = feature(topo, topo.objects.states)

const INITIAL_VIEW = { longitude: -96.5, latitude: 38.6, zoom: 3.6, pitch: 0, bearing: 0 }
const CAT_RGB = CATS.map((c) => hexToRgb(CAT_META[c].color))
const TRAIL_HOURS = 3

interface Props {
  day: Day
  hour: number | null
  mode: 'origin' | 'felt'
  selection: Selection
  onSelect: (s: Selection) => void
}

interface AirportPoint {
  i: number
  code: string
  position: [number, number]
  total: number
  byCat: number[]
  dominant: number
  deps: number
}

export default function DelayMap({ day, hour, mode, selection, onSelect }: Props) {
  const points = useMemo<AirportPoint[]>(() => {
    return day.airports.map((a, i) => {
      const byCat = airportByCat(a, mode, hour)
      const total = sum(byCat)
      const dominant = byCat.indexOf(Math.max(...byCat))
      const deps = hour == null ? sum(a.deps) : a.deps[hour]
      return { i, code: a.code, position: [a.lon, a.lat], total, byCat, dominant, deps }
    })
  }, [day, hour, mode])

  const maxTotal = useMemo(() => Math.max(1, ...points.map((p) => p.total)), [points])

  // Greedy declutter: biggest airports claim their label first; the NYC trio would otherwise overprint.
  const labels = useMemo(() => {
    const placed: AirportPoint[] = []
    for (const p of [...points].sort((a, b) => b.total - a.total)) {
      if (p.total <= 0 || placed.length >= 16) break
      const clear = placed.every((q) => Math.abs(q.position[0] - p.position[0]) > 2.2 || Math.abs(q.position[1] - p.position[1]) > 1.1)
      if (clear) placed.push(p)
    }
    return placed
  }, [points])

  const selectedAirport = selection?.type === 'airport' ? selection.index : null
  const selectedFlight = selection?.type === 'flight' ? selection.index : null

  const arcs = useMemo(() => {
    let xs = day.arcs
    if (hour != null) xs = xs.filter((a) => a[2] <= hour && a[2] > hour - TRAIL_HOURS)
    if (selectedAirport != null) xs = xs.filter((a) => a[0] === selectedAirport || a[1] === selectedAirport)
    // Whole-day view would be a hairball; keep the arcs that carry real weight.
    if (hour == null && selectedAirport == null) {
      const sorted = [...xs].sort((a, b) => b[4] - a[4])
      xs = sorted.slice(0, 400)
    }
    return xs
  }, [day, hour, selectedAirport])

  // The selected flight's whole tail chain, drawn as its actual legs.
  const chainLegs = useMemo(() => {
    if (selectedFlight == null) return []
    const f = day.flights
    const tail = f.tail[selectedFlight]
    const legs: { from: [number, number]; to: [number, number]; selected: boolean }[] = []
    f.tail.forEach((t, k) => {
      if ((tail && t === tail) || k === selectedFlight) {
        if (f.status[k].startsWith('C')) return
        const o = day.airports[f.o[k]]
        const d = day.airports[f.d[k]]
        legs.push({ from: [o.lon, o.lat], to: [d.lon, d.lat], selected: k === selectedFlight })
      }
    })
    return legs
  }, [day, selectedFlight])

  const radius = (p: AirportPoint) => (p.total > 0 ? 3 + 28 * Math.sqrt(p.total / maxTotal) : 2)
  const dimArcs = selectedFlight != null

  const layers = [
    new GeoJsonLayer({
      id: 'states',
      data: states,
      filled: true,
      stroked: true,
      getFillColor: [37, 42, 49, 255],
      getLineColor: [64, 72, 84, 255],
      lineWidthMinPixels: 0.6,
    }),
    new ArcLayer<Arc>({
      id: 'arcs',
      data: arcs,
      getSourcePosition: (a) => [day.airports[a[0]].lon, day.airports[a[0]].lat],
      getTargetPosition: (a) => [day.airports[a[1]].lon, day.airports[a[1]].lat],
      getSourceColor: (a) => withAlpha(CAT_RGB[a[3]], arcAlpha(a, hour, dimArcs) * 0.5),
      getTargetColor: (a) => withAlpha(CAT_RGB[a[3]], arcAlpha(a, hour, dimArcs)),
      getWidth: (a) => Math.min(8, 0.6 + Math.sqrt(a[4]) / 6),
      getHeight: 0.35,
      greatCircle: false,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 200],
      updateTriggers: { getSourceColor: [hour, dimArcs], getTargetColor: [hour, dimArcs] },
    }),
    new ArcLayer({
      id: 'chain',
      data: chainLegs,
      getSourcePosition: (l) => l.from,
      getTargetPosition: (l) => l.to,
      getSourceColor: (l) => (l.selected ? [255, 255, 255, 255] : [255, 255, 255, 110]),
      getTargetColor: (l) => (l.selected ? [255, 255, 255, 255] : [255, 255, 255, 110]),
      getWidth: (l) => (l.selected ? 3 : 1.5),
      getHeight: 0.2,
    }),
    new ScatterplotLayer<AirportPoint>({
      id: 'airports',
      data: points,
      getPosition: (p) => p.position,
      getRadius: radius,
      radiusUnits: 'pixels',
      getFillColor: (p) => (p.total > 0 ? withAlpha(CAT_RGB[p.dominant], 215) : [143, 153, 168, 140]),
      // 2px surface ring so overlapping circles stay separable
      stroked: true,
      getLineColor: (p) => (p.i === selectedAirport ? [255, 255, 255, 255] : [28, 33, 39, 255]),
      getLineWidth: (p) => (p.i === selectedAirport ? 2.5 : 1.5),
      lineWidthUnits: 'pixels',
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 60],
      updateTriggers: { getRadius: [maxTotal], getLineColor: [selectedAirport], getLineWidth: [selectedAirport] },
      transitions: { getRadius: 250 },
    }),
    new TextLayer<AirportPoint>({
      id: 'labels',
      data: labels,
      getPosition: (p) => p.position,
      getText: (p) => p.code,
      getSize: 11,
      getColor: [246, 247, 249, 230],
      getPixelOffset: (p) => [0, -radius(p) - 9],
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontWeight: 600,
      outlineWidth: 3,
      outlineColor: [28, 33, 39, 255],
      fontSettings: { sdf: true },
      updateTriggers: { getPixelOffset: [maxTotal] },
    }),
  ]

  const getTooltip = (info: PickingInfo) => {
    if (!info.object) return null
    if (info.layer?.id === 'airports') {
      const p = info.object as AirportPoint
      const a = day.airports[p.i]
      const verb = mode === 'origin' ? 'started here' : 'landed here'
      const rows = CATS.map((c, k) => [c, p.byCat[k]] as const)
        .filter(([, v]) => v > 0)
        .sort((x, y) => y[1] - x[1])
        .map(([c, v]) => `<div class="tt-row"><i style="background:${CAT_META[c].color}"></i>${CAT_META[c].short}<b>${dur(v)}</b></div>`)
        .join('')
      return {
        html: `<div class="tt-title">${a.code} · ${a.city}</div>
          <div class="tt-sub">${p.total ? `${dur(p.total)} of delay ${verb}` : 'No traced delay'}${hour == null ? '' : ` · ${hourLabel(hour)}–${hourLabel(hour + 1)} ET`}</div>${rows}`,
        className: 'tooltip',
        style: { background: 'none', padding: '0' },
      }
    }
    if (info.layer?.id === 'arcs') {
      const a = info.object as Arc
      const cat = CATS[a[3]]
      return {
        html: `<div class="tt-title">${day.airports[a[0]].code} → ${day.airports[a[1]].code}</div>
          <div class="tt-sub">${dur(a[4])} of ${CAT_META[cat].short.toLowerCase()} delay carried by ${a[5].length} aircraft, landing ~${hourLabel(a[2])} ET</div>`,
        className: 'tooltip',
        style: { background: 'none', padding: '0' },
      }
    }
    return null
  }

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW}
      controller={{ dragRotate: false, touchRotate: false }}
      layers={layers}
      getTooltip={getTooltip}
      getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
      onClick={(info) => {
        if (!info.object) return onSelect(null)
        if (info.layer?.id === 'airports') onSelect({ type: 'airport', index: (info.object as AirportPoint).i })
        if (info.layer?.id === 'arcs') onSelect({ type: 'arc', arc: info.object as Arc })
      }}
    />
  )
}

function withAlpha(c: [number, number, number, number], a: number): [number, number, number, number] {
  return [c[0], c[1], c[2], Math.round(a)]
}

function arcAlpha(a: Arc, hour: number | null, dim: boolean) {
  const base = dim ? 50 : 230
  if (hour == null) return base * 0.75
  const age = hour - a[2] // 0 = landing this hour
  return base * (1 - age / TRAIL_HOURS) + 20
}
