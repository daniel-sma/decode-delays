import { useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { WebMercatorViewport, type MapViewState } from '@deck.gl/core'
import { ArcLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { Button, ButtonGroup, Classes, Tag } from '@blueprintjs/core'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import statesTopo from 'us-atlas/states-10m.json'
import { CATS, decodedByCat, flightLabel, type Day } from '../data'
import { CAT_META, clock, dur, hexToRgb } from '../theme'

const topo = statesTopo as unknown as Topology
const states = feature(topo, topo.objects.states)
const CAT_RGB = CATS.map((c) => hexToRgb(CAT_META[c].color))
const MUTED: [number, number, number, number] = [143, 153, 168, 255]

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
  selected: boolean
  cancelled: boolean
}

interface Stop {
  airport: number
  position: [number, number]
  arrive?: number // leg index arriving here
  depart?: number // leg index departing here
}

/** Map of one aircraft's day: its legs, each airport it touched, and where the delay began. */
export default function FlightMap({ day, chain, selected, onSelect }: Props) {
  const f = day.flights
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [view, setView] = useState<MapViewState>({ longitude: -96, latitude: 38.5, zoom: 3.6 })
  const [showCallouts, setShowCallouts] = useState(true)
  const [fitKey, setFitKey] = useState(0)

  const legs = useMemo<Leg[]>(() => chain.map((i) => {
    const o = day.airports[f.o[i]], d = day.airports[f.d[i]]
    const by = decodedByCat(f.decoded[i])
    const top = by.indexOf(Math.max(...by))
    const late = (f.arrDelay[i] ?? 0) >= 15
    return {
      i, from: [o.lon, o.lat], to: [d.lon, d.lat],
      color: late && by[top] > 0 ? CAT_RGB[top] : MUTED,
      selected: i === selected, cancelled: f.status[i].startsWith('C'),
    }
  }), [day, chain, selected, f])

  // One stop per airport visit, in order: the plane lands, then leaves again.
  const stops = useMemo<Stop[]>(() => {
    const out: Stop[] = []
    chain.forEach((i, n) => {
      const prev = out[out.length - 1]
      if (n === 0 || !prev || prev.airport !== f.o[i]) {
        const a = day.airports[f.o[i]]
        out.push({ airport: f.o[i], position: [a.lon, a.lat], depart: i })
      } else prev.depart = i
      const d = day.airports[f.d[i]]
      out.push({ airport: f.d[i], position: [d.lon, d.lat], arrive: i })
    })
    return out
  }, [day, chain, f])

  // Airports where a meaningful share (10%+) of the selected flight's delay began.
  const rootAirports = useMemo(() => {
    const cs = f.decoded[selected]
    const total = cs.reduce((a, c) => a + c[5], 0)
    const byAp = new Map<number, number>()
    for (const c of cs) byAp.set(c[1], (byAp.get(c[1]) ?? 0) + c[5])
    return new Set([...byAp].filter(([, m]) => total && m / total >= 0.1).map(([ap]) => ap))
  }, [f, selected])

  // Fit the plane's route whenever the chain or the container changes.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!stops.length || size.width < 50) return
    const lons = stops.map((s) => s.position[0]), lats = stops.map((s) => s.position[1])
    const vp = new WebMercatorViewport({ width: size.width, height: size.height })
    const pad = { top: 140, bottom: 230, left: 140, right: 140 }
    const fit = vp.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
      padding: { top: Math.min(pad.top, size.height / 4), bottom: Math.min(pad.bottom, size.height / 3), left: Math.min(pad.left, size.width / 5), right: Math.min(pad.right, size.width / 5) },
      maxZoom: 6.5,
    })
    setView({ longitude: fit.longitude, latitude: fit.latitude, zoom: Math.min(fit.zoom, 6.5) })
  }, [chain, size.width, size.height, fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const viewport = useMemo(() => new WebMercatorViewport({ ...view, width: size.width, height: size.height }), [view, size])

  const layers = [
    new GeoJsonLayer({
      id: 'states', data: states, filled: true, stroked: true,
      getFillColor: [37, 42, 49, 255], getLineColor: [64, 72, 84, 255], lineWidthMinPixels: 0.6,
    }),
    new ArcLayer<Leg>({
      id: 'legs', data: legs,
      getSourcePosition: (l) => l.from, getTargetPosition: (l) => l.to,
      getSourceColor: (l) => (l.cancelled ? [143, 153, 168, 70] : l.selected ? [246, 247, 249, 255] : [l.color[0], l.color[1], l.color[2], 150]),
      getTargetColor: (l) => (l.cancelled ? [143, 153, 168, 70] : l.selected ? [246, 247, 249, 255] : [l.color[0], l.color[1], l.color[2], 255]),
      getWidth: (l) => (l.selected ? 4 : 2.5), getHeight: 0.25,
      pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 120],
      updateTriggers: { getSourceColor: [selected], getTargetColor: [selected], getWidth: [selected] },
    }),
    new ScatterplotLayer<Stop>({
      id: 'root-halo', data: stops.filter((s) => rootAirports.has(s.airport)),
      getPosition: (s) => s.position, getRadius: 16, radiusUnits: 'pixels',
      filled: false, stroked: true, getLineColor: [76, 144, 240, 200], getLineWidth: 2, lineWidthUnits: 'pixels',
    }),
    new ScatterplotLayer<Stop>({
      id: 'stops', data: stops,
      getPosition: (s) => s.position, getRadius: 6, radiusUnits: 'pixels',
      getFillColor: [246, 247, 249, 255], stroked: true, getLineColor: [28, 33, 39, 255], getLineWidth: 2, lineWidthUnits: 'pixels',
    }),
  ]

  // Callouts: one per airport. Each tries a few spots around its dot and takes the first that
  // doesn't collide with one already placed (busiest airports first), so JFK/LGA/PHL stay readable.
  const callouts = useMemo(() => {
    const byAirport = new Map<number, Stop[]>()
    for (const s of stops) byAirport.set(s.airport, [...(byAirport.get(s.airport) ?? []), s])
    const W = 214, GAP = 12
    const boxes: { x: number; y: number; w: number; h: number }[] = []
    const hit = (b: { x: number; y: number; w: number; h: number }) =>
      boxes.some((o) => b.x < o.x + o.w + 4 && b.x + b.w + 4 > o.x && b.y < o.y + o.h + 4 && b.y + b.h + 4 > o.y)
    const entries = [...byAirport.entries()].sort((a, b) => b[1].length - a[1].length)
    return entries.map(([ap, visits]) => {
      const [x, y] = viewport.project(visits[0].position)
      const rows = visits.reduce((n, v) => n + (v.arrive != null ? 1 : 0) + (v.depart != null ? 1 : 0), 0)
      const h = 30 + rows * 16
      const spots = [
        { x: x - W / 2, y: y - h - GAP }, { x: x - W / 2, y: y + GAP },
        { x: x + GAP + 4, y: y - h / 2 }, { x: x - W - GAP - 4, y: y - h / 2 },
        { x: x + GAP, y: y - h - GAP }, { x: x - W - GAP, y: y + GAP },
        { x: x + GAP, y: y + GAP }, { x: x - W - GAP, y: y - h - GAP },
        { x: x - W / 2, y: y - 2 * h - GAP - 8 }, { x: x - W / 2, y: y + h + GAP + 8 },
      ]
      const spot = spots.find((p) => !hit({ ...p, w: W, h })) ?? spots[0]
      const box = { ...spot, w: W, h }
      boxes.push(box)
      return { ap, visits, box, anchor: { x, y } }
    })
  }, [stops, viewport])

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
          html: `<div class="tt-title">${flightLabel(day, (info.object as Leg).i)}</div><div class="tt-sub">Click to select this leg</div>`,
          className: 'tooltip', style: { background: 'none', padding: '0' },
        } : null}
      />
      {showCallouts && (
        <div className="callouts">
          <svg className="leaders" width={size.width} height={size.height}>
            {callouts.map(({ ap, box, anchor }) => {
              const cx = Math.max(box.x, Math.min(anchor.x, box.x + box.w))
              const cy = Math.max(box.y, Math.min(anchor.y, box.y + box.h))
              return <line key={ap} x1={anchor.x} y1={anchor.y} x2={cx} y2={cy} />
            })}
          </svg>
          {callouts.map(({ ap, visits, box }) => {
            const a = day.airports[ap]
            const isRoot = rootAirports.has(ap)
            return (
              <div key={ap} className={`callout${isRoot ? ' root' : ''}`} style={{ left: box.x, top: box.y, width: box.w }}>
                <div className="callout-head">
                  <strong>{a.code}</strong>
                  {isRoot && <Tag minimal intent="primary" className="callout-tag">delay started here</Tag>}
                </div>
                <table>
                  <tbody>
                    {visits.map((v, k) => (
                      <CalloutRows key={k} day={day} stop={v} />
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
      <ButtonGroup className="map-tools" vertical>
        <Button icon={showCallouts ? 'eye-open' : 'eye-off'} onClick={() => setShowCallouts(!showCallouts)} aria-label="Toggle airport details" title="Airport details" />
        <Button icon="zoom-in" onClick={() => setView({ ...view, zoom: view.zoom + 0.6 })} aria-label="Zoom in" />
        <Button icon="zoom-out" onClick={() => setView({ ...view, zoom: view.zoom - 0.6 })} aria-label="Zoom out" />
        <Button icon="zoom-to-fit" onClick={() => setFitKey((k) => k + 1)} aria-label="Fit route" title="Fit route" />
      </ButtonGroup>
      <div className={`map-attrib ${Classes.TEXT_MUTED}`}>US Census boundaries · times Eastern</div>
    </div>
  )
}

function CalloutRows({ day, stop }: { day: Day; stop: Stop }) {
  const f = day.flights
  const rows: [string, React.ReactNode][] = []
  if (stop.arrive != null) {
    const i = stop.arrive
    const late = f.arrDelay[i]
    rows.push([`Arr ${flightLabel(day, i)}`, f.status[i].startsWith('C') ? 'Cancelled' : <>{clock(f.sarr[i] + (late ?? 0))} {late != null && late >= 15 && <b className="late">+{dur(late)}</b>}</>])
  }
  if (stop.depart != null) {
    const i = stop.depart
    const late = f.depDelay[i]
    rows.push([`Dep ${flightLabel(day, i)}`, f.status[i].startsWith('C') ? 'Cancelled' : <>{clock(f.sdep[i] + (late ?? 0))} {late != null && late >= 15 && <b className="late">+{dur(late)}</b>}</>])
  }
  return <>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</>
}
