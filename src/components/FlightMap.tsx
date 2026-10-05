import { useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { WebMercatorViewport, type MapViewState } from '@deck.gl/core'
import { ArcLayer, GeoJsonLayer, IconLayer, LineLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Button, ButtonGroup, Card } from '@blueprintjs/core'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import statesTopo from 'us-atlas/states-10m.json'
import { flightLabel, type Day } from '../data'
import { clock, dur } from '../theme'
import { actualArr, actualDep } from './Scrubber'

const topo = statesTopo as unknown as Topology
const states = feature(topo, topo.objects.states)
const LATE: [number, number, number, number] = [76, 144, 240, 255] // Blueprint blue-4
const ON_TIME: [number, number, number, number] = [143, 153, 168, 255]
// A plane pointing north; masked so deck.gl tints it.
const PLANE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><path fill="#fff" d="M12 2c.8 0 1.4.9 1.4 2v5.2l7.6 4.6v2l-7.6-2.3v4.6l2.2 1.7V21L12 20l-3.6 1v-1.2l2.2-1.7v-4.6L3 15.8v-2l7.6-4.6V4c0-1.1.6-2 1.4-2z"/></svg>')}`

interface Props {
  day: Day
  chain: number[]
  selected: number
  /** minutes relative to midnight ET */
  time: number
  onSelect: (i: number) => void
}

interface Leg {
  i: number
  from: [number, number]
  to: [number, number]
  color: [number, number, number, number]
  cancelled: boolean
  dep: number
  arr: number
}

/**
 * One aircraft's day. Legs are coloured by their biggest root cause (grey when on time), the selected
 * leg is white, every airport gets a small code label, and only the selected leg's two airports get
 * a detail card.
 */
export default function FlightMap({ day, chain, selected, time, onSelect }: Props) {
  const f = day.flights
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<MapViewState>({ longitude: -96, latitude: 38.5, zoom: 3.6 })
  const [fitKey, setFitKey] = useState(0)

  const legs = useMemo<Leg[]>(() => chain.map((i) => {
    const o = day.airports[f.o[i]], d = day.airports[f.d[i]]
    const late = (f.arrDelay[i] ?? 0) >= 15
    return {
      i, from: [o.lon, o.lat], to: [d.lon, d.lat], color: late ? LATE : ON_TIME,
      cancelled: f.status[i].startsWith('C'), dep: actualDep(day, i), arr: actualArr(day, i),
    }
  }), [day, chain, f])

  // Where the aircraft is at the playhead: on a leg in the air, or parked where it last landed.
  const plane = useMemo(() => {
    const flown = legs.filter((l) => !l.cancelled)
    if (!flown.length) return null
    for (const l of flown) {
      if (time < l.dep) return { pos: l.from, angle: bearing(l.from, l.to), leg: null as Leg | null, p: 0 }
      if (time <= l.arr) {
        const p = l.arr > l.dep ? (time - l.dep) / (l.arr - l.dep) : 1
        const pos: [number, number] = [l.from[0] + (l.to[0] - l.from[0]) * p, l.from[1] + (l.to[1] - l.from[1]) * p]
        return { pos, angle: bearing(l.from, l.to), leg: l, p }
      }
    }
    const last = flown[flown.length - 1]
    return { pos: last.to, angle: bearing(last.from, last.to), leg: null as Leg | null, p: 1 }
  }, [legs, time])

  const airports = useMemo(() => [...new Set(chain.flatMap((i) => [f.o[i], f.d[i]]))], [chain, f])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit the whole route when the aircraft changes, the container resizes, or "Fit" is pressed.
  useEffect(() => {
    if (!airports.length || size.width < 50) return
    const pts = airports.map((a) => [day.airports[a].lon, day.airports[a].lat])
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1])
    const pad = Math.min(120, size.width / 6, size.height / 5)
    const fit = new WebMercatorViewport({ width: size.width, height: size.height }).fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: pad, maxZoom: 6.5 },
    )
    setView({ longitude: fit.longitude, latitude: fit.latitude, zoom: Math.min(fit.zoom, 6.5) })
  }, [airports, size.width, size.height, fitKey, day])

  const viewport = useMemo(
    () => (size.width ? new WebMercatorViewport({ ...view, width: size.width, height: size.height }) : null),
    [view, size],
  )

  const layers = [
    new GeoJsonLayer({
      id: 'states', data: states, filled: true, stroked: true,
      getFillColor: [37, 42, 49, 255], getLineColor: [64, 72, 84, 255], lineWidthMinPixels: 0.6,
    }),
    // Legs not yet flown are faint; flown legs carry their root-cause colour; the selected leg is white.
    new ArcLayer<Leg>({
      id: 'legs', data: legs,
      getSourcePosition: (l) => l.from, getTargetPosition: (l) => l.to,
      getSourceColor: (l) => legColor(l, selected, time, 0.55),
      getTargetColor: (l) => legColor(l, selected, time, 1),
      getWidth: (l) => (l.i === selected ? 3.5 : 2.5), getHeight: 0,
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 120],
      updateTriggers: { getSourceColor: [selected, time], getTargetColor: [selected, time], getWidth: [selected] },
    }),
    new LineLayer({
      id: 'progress', data: plane?.leg ? [plane] : [],
      getSourcePosition: (d) => d.leg!.from, getTargetPosition: (d) => d.pos,
      getColor: [246, 247, 249, 255], getWidth: 3.5,
    }),
    new ScatterplotLayer<number>({
      id: 'airports', data: airports,
      getPosition: (a) => [day.airports[a].lon, day.airports[a].lat], getRadius: 5, radiusUnits: 'pixels',
      getFillColor: [246, 247, 249, 255], stroked: true, getLineColor: [28, 33, 39, 255], getLineWidth: 2, lineWidthUnits: 'pixels',
    }),
    new ScatterplotLayer({
      id: 'plane-halo', data: plane ? [plane] : [],
      getPosition: (d) => d.pos, getRadius: 16, radiusUnits: 'pixels',
      getFillColor: [45, 114, 210, 90], stroked: true, getLineColor: [76, 144, 240, 220], getLineWidth: 1.5, lineWidthUnits: 'pixels',
    }),
    new IconLayer({
      id: 'plane', data: plane ? [plane] : [],
      getPosition: (d) => d.pos, getIcon: () => ({ url: PLANE, width: 64, height: 64, mask: true }),
      getSize: 26, sizeUnits: 'pixels', getAngle: (d) => -d.angle, getColor: [246, 247, 249, 255],
      updateTriggers: { getAngle: [time] },
    }),
  ]

  const sel = { o: f.o[selected], d: f.d[selected] }
  const labels = useMemo(() => {
    if (!viewport) return []
    // Detail cards first, then code chips, each taking the first nearby spot that doesn't collide.
    const order = [sel.o, sel.d, ...airports.filter((a) => a !== sel.o && a !== sel.d)]
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const hit = (b: { x: number; y: number; w: number; h: number }) =>
      placed.some((o) => b.x < o.x + o.w + 4 && b.x + b.w + 4 > o.x && b.y < o.y + o.h + 4 && b.y + b.h + 4 > o.y)
    return order.map((ap) => {
      const a = day.airports[ap]
      const [x, y] = viewport.project([a.lon, a.lat])
      const detail = ap === sel.o || ap === sel.d
      const w = detail ? 176 : 44, h = detail ? 52 : 22, g = 10
      const spots = [
        { x: x - w / 2, y: y - h - g }, { x: x - w / 2, y: y + g }, { x: x + g, y: y - h / 2 }, { x: x - w - g, y: y - h / 2 },
        { x: x + g, y: y - h - g }, { x: x - w - g, y: y + g }, { x: x + g, y: y + g }, { x: x - w - g, y: y - h - g },
      ]
      const spot = spots.find((p) => !hit({ ...p, w, h })) ?? spots[0]
      const box = { ...spot, w, h }
      placed.push(box)
      return { ap, detail, box, anchor: { x, y } }
    })
  }, [viewport, airports, day, sel.o, sel.d])

  const dep = f.sdep[selected] + Math.max(0, f.depDelay[selected] ?? 0)
  const arr = f.sarr[selected] + (f.arrDelay[selected] ?? 0)
  const cancelled = f.status[selected].startsWith('C')

  return (
    <div className="flight-map" ref={wrap}>
      <DeckGL
        viewState={view}
        onViewStateChange={({ viewState }) => setView(viewState as MapViewState)}
        controller={{ dragRotate: false, touchRotate: false }}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
        onClick={(info) => info.layer?.id === 'legs' && info.object && onSelect((info.object as Leg).i)}
        getTooltip={(info) => info.layer?.id === 'legs' && info.object ? {
          html: `<div class="tt-title">${flightLabel(day, (info.object as Leg).i)}</div>`,
          className: 'tooltip', style: { background: 'none', padding: '0' },
        } : null}
      />
      <div className="callouts" aria-hidden>
        <svg className="leaders" width={size.width} height={size.height}>
          {labels.map(({ ap, box, anchor }) => (
            <line key={ap} x1={anchor.x} y1={anchor.y} x2={Math.max(box.x, Math.min(anchor.x, box.x + box.w))} y2={Math.max(box.y, Math.min(anchor.y, box.y + box.h))} />
          ))}
        </svg>
        {labels.map(({ ap, detail, box }) => {
          const code = day.airports[ap].code
          if (!detail) return <span key={ap} className="chip" style={{ left: box.x, top: box.y, width: box.w }}>{code}</span>
          const isOrigin = ap === sel.o
          const late = isOrigin ? f.depDelay[selected] : f.arrDelay[selected]
          return (
            <div key={ap} className="callout" style={{ left: box.x, top: box.y, width: box.w }}>
              <div className="callout-head"><strong>{code}</strong><span>{isOrigin ? 'Departs' : 'Arrives'}</span></div>
              <div className="callout-row">
                {cancelled ? 'Cancelled' : <>{clock(isOrigin ? dep : arr)}{late != null && late >= 15 && <b className="late"> +{dur(late)}</b>}</>}
              </div>
            </div>
          )
        })}
      </div>

      <Card compact className="map-legend">
        <span><i style={{ background: '#4c90f0' }} />Arrived 15+ min late</span>
        <span><i style={{ background: '#8f99a8' }} />On time</span>
        <span><i className="sel" />Selected</span>
        <span><i className="future" />Not flown yet</span>
      </Card>
      <ButtonGroup className="map-tools" vertical>
        <Button icon="zoom-in" onClick={() => setView({ ...view, zoom: view.zoom + 0.6 })} aria-label="Zoom in" />
        <Button icon="zoom-out" onClick={() => setView({ ...view, zoom: view.zoom - 0.6 })} aria-label="Zoom out" />
        <Button icon="zoom-to-fit" onClick={() => setFitKey((k) => k + 1)} aria-label="Fit route" />
      </ButtonGroup>
    </div>
  )
}

function legColor(l: Leg, selected: number, time: number, alpha: number): [number, number, number, number] {
  if (l.cancelled) return [143, 153, 168, 50]
  if (l.i === selected) return [246, 247, 249, Math.round(255 * (time < l.dep ? 0.45 : alpha))]
  if (time < l.dep) return [143, 153, 168, 55]
  return [l.color[0], l.color[1], l.color[2], Math.round(255 * alpha)]
}

/** Screen bearing (degrees clockwise from north) from a to b, good enough at map scale. */
function bearing(a: [number, number], b: [number, number]) {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return (Math.atan2(dx, b[1] - a[1]) * 180) / Math.PI
}
