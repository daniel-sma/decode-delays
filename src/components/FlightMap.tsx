import { useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { WebMercatorViewport, type MapViewState } from '@deck.gl/core'
import { ArcLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Button, ButtonGroup, Card } from '@blueprintjs/core'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import statesTopo from 'us-atlas/states-10m.json'
import { CATS, decodedByCat, flightLabel, type Day } from '../data'
import { CAT_META, clock, dur, hexToRgb } from '../theme'

const topo = statesTopo as unknown as Topology
const states = feature(topo, topo.objects.states)
const CAT_RGB = CATS.map((c) => hexToRgb(CAT_META[c].color))
const ON_TIME: [number, number, number, number] = [143, 153, 168, 255]
const LEGEND = ['weather', 'airspace', 'airline'] as const

interface Props {
  day: Day
  chain: number[]
  selected: number
  onSelect: (i: number) => void
}

interface Leg {
  i: number
  from: [number, number]
  to: [number, number]
  color: [number, number, number, number]
  cancelled: boolean
}

/**
 * One aircraft's day. Legs are coloured by their biggest root cause (grey when on time), the selected
 * leg is white, every airport gets a small code label, and only the selected leg's two airports get
 * a detail card.
 */
export default function FlightMap({ day, chain, selected, onSelect }: Props) {
  const f = day.flights
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<MapViewState>({ longitude: -96, latitude: 38.5, zoom: 3.6 })
  const [fitKey, setFitKey] = useState(0)

  const legs = useMemo<Leg[]>(() => chain.map((i) => {
    const o = day.airports[f.o[i]], d = day.airports[f.d[i]]
    const by = decodedByCat(f.decoded[i])
    const top = by.indexOf(Math.max(...by))
    const late = (f.arrDelay[i] ?? 0) >= 15 && by[top] > 0
    return { i, from: [o.lon, o.lat], to: [d.lon, d.lat], color: late ? CAT_RGB[top] : ON_TIME, cancelled: f.status[i].startsWith('C') }
  }), [day, chain, f])

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
    new ArcLayer<Leg>({
      id: 'legs', data: legs,
      getSourcePosition: (l) => l.from, getTargetPosition: (l) => l.to,
      getSourceColor: (l) => (l.i === selected ? [246, 247, 249, 255] : l.cancelled ? [143, 153, 168, 60] : [l.color[0], l.color[1], l.color[2], 140]),
      getTargetColor: (l) => (l.i === selected ? [246, 247, 249, 255] : l.cancelled ? [143, 153, 168, 60] : [l.color[0], l.color[1], l.color[2], 255]),
      getWidth: (l) => (l.i === selected ? 4 : 2.5), getHeight: 0.25,
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 120],
      updateTriggers: { getSourceColor: [selected], getTargetColor: [selected], getWidth: [selected] },
    }),
    new ScatterplotLayer<number>({
      id: 'airports', data: airports,
      getPosition: (a) => [day.airports[a].lon, day.airports[a].lat], getRadius: 5, radiusUnits: 'pixels',
      getFillColor: [246, 247, 249, 255], stroked: true, getLineColor: [28, 33, 39, 255], getLineWidth: 2, lineWidthUnits: 'pixels',
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
        {LEGEND.map((c) => <span key={c}><i style={{ background: CAT_META[c].color }} />{CAT_META[c].short}</span>)}
        <span><i style={{ background: '#8f99a8' }} />On time</span>
        <span><i className="sel" />Selected</span>
      </Card>
      <ButtonGroup className="map-tools" vertical>
        <Button icon="zoom-in" onClick={() => setView({ ...view, zoom: view.zoom + 0.6 })} aria-label="Zoom in" />
        <Button icon="zoom-out" onClick={() => setView({ ...view, zoom: view.zoom - 0.6 })} aria-label="Zoom out" />
        <Button icon="zoom-to-fit" onClick={() => setFitKey((k) => k + 1)} aria-label="Fit route" />
      </ButtonGroup>
    </div>
  )
}
