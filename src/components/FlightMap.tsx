import { useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { MapView, WebMercatorViewport, type MapViewState } from '@deck.gl/core'
import { BitmapLayer, GeoJsonLayer, IconLayer, LineLayer, ScatterplotLayer } from '@deck.gl/layers'
import { TileLayer } from '@deck.gl/geo-layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { Button, ButtonGroup, Icon } from '@blueprintjs/core'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import statesTopo from 'us-atlas/states-10m.json'
import { flightLabel, type Day } from '../data'
import { clock, dur } from '../theme'
import { actualArr, actualDep } from './Scrubber'

const topo = statesTopo as unknown as Topology
const states = feature(topo, topo.objects.states)

// Bundled satellite image (NASA Blue Marble, see pipeline/make_basemap.py); bounds must match that script.
const BASEMAP = `${import.meta.env.BASE_URL}basemap/world.jpg`
const BASEMAP_BOUNDS: [number, number, number, number] = [-180, -85.0511, 180, 85.0511]
const MIN_ZOOM = 1.6 // the whole world fills the view; no empty space past the poles
const MAX_ZOOM = 9
// Repeat the world horizontally so panning past the antimeridian never shows empty space.
const VIEW = new MapView({ repeat: true })
// Sharper imagery where the host is reachable; tiles that fail to load leave the bundled image showing.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

type RGBA = [number, number, number, number]
const LATE: RGBA = [255, 191, 39, 255] // Southwest sunrise yellow
const ON_TIME: RGBA = [123, 151, 255, 255] // Southwest blue, lifted for the dark map
const WHITE: RGBA = [255, 255, 255, 255]
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
  late: boolean
  cancelled: boolean
  dep: number
  arr: number
}

/** One aircraft's day over satellite imagery: flown legs solid, legs still to fly dashed, the plane at the playhead. */
export default function FlightMap({ day, chain, selected, time, onSelect }: Props) {
  const f = day.flights
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<MapViewState>({ longitude: -96, latitude: 38.5, zoom: 3.6 })
  const [fitKey, setFitKey] = useState(0)

  const legs = useMemo<Leg[]>(() => chain.map((i) => {
    const o = day.airports[f.o[i]], d = day.airports[f.d[i]]
    return {
      i, from: [o.lon, o.lat], to: [d.lon, d.lat], late: (f.arrDelay[i] ?? 0) >= 15,
      cancelled: f.status[i].startsWith('C'), dep: actualDep(day, i), arr: actualArr(day, i),
    }
  }), [day, chain, f])

  // Where the aircraft is at the playhead: on a leg in the air, or parked where it last landed.
  const plane = useMemo(() => {
    const flying = legs.filter((l) => !l.cancelled)
    if (!flying.length) return null
    for (const l of flying) {
      if (time < l.dep) return { pos: l.from, angle: bearing(l.from, l.to), leg: null as Leg | null }
      if (time <= l.arr) {
        const p = l.arr > l.dep ? (time - l.dep) / (l.arr - l.dep) : 1
        const pos: [number, number] = [l.from[0] + (l.to[0] - l.from[0]) * p, l.from[1] + (l.to[1] - l.from[1]) * p]
        return { pos, angle: bearing(l.from, l.to), leg: l }
      }
    }
    const last = flying[flying.length - 1]
    return { pos: last.to, angle: bearing(last.from, last.to), leg: null as Leg | null }
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
    const lons = airports.map((a) => day.airports[a].lon), lats = airports.map((a) => day.airports[a].lat)
    const pad = Math.min(110, size.width / 6, size.height / 5)
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

  const flown = legs.filter((l) => !l.cancelled && time >= l.arr && l.i !== selected)
  const upcoming = legs.filter((l) => !l.cancelled && time < l.dep && l.i !== selected)
  const sel = legs.find((l) => l.i === selected)
  const planeOnSel = plane?.leg?.i === selected

  const layers = [
    new BitmapLayer({ id: 'basemap', image: BASEMAP, bounds: BASEMAP_BOUNDS }),
    new TileLayer({
      id: 'imagery', data: ESRI, minZoom: 0, maxZoom: 17, tileSize: 256, maxRequests: 8,
      onTileError: () => {}, // blocked or offline: the bundled image underneath stays visible
      renderSubLayers: (props) => {
        const [[west, south], [east, north]] = props.tile.boundingBox
        return new BitmapLayer(props, { data: undefined, image: props.data, bounds: [west, south, east, north], opacity: 0.8 })
      },
    }),
    new GeoJsonLayer({ id: 'states', data: states, filled: false, stroked: true, getLineColor: [255, 255, 255, 40], lineWidthMinPixels: 0.6 }),
    // Legs still to fly are dashed, like a planned route.
    new LineLayer<Leg, { getDashArray: [number, number] }>({
      id: 'upcoming', data: upcoming, getSourcePosition: (l) => l.from, getTargetPosition: (l) => l.to,
      getColor: [255, 255, 255, 140], getWidth: 1.5,
      extensions: [new PathStyleExtension({ dash: true })], getDashArray: [6, 5],
    }),
    new LineLayer<Leg>({
      id: 'flown', data: flown, getSourcePosition: (l) => l.from, getTargetPosition: (l) => l.to,
      getColor: (l) => (l.late ? LATE : ON_TIME), getWidth: 3, pickable: true, autoHighlight: true, highlightColor: [255, 255, 255, 160],
    }),
    // Selected leg: dashed ahead of the plane, solid behind it.
    new LineLayer<Leg, { getDashArray: [number, number] }>({
      id: 'selected-ahead', data: sel && !sel.cancelled && time < sel.arr ? [sel] : [],
      getSourcePosition: (l) => (planeOnSel && plane ? plane.pos : l.from), getTargetPosition: (l) => l.to,
      getColor: [255, 255, 255, 210], getWidth: 2,
      extensions: [new PathStyleExtension({ dash: true })], getDashArray: [6, 5],
      updateTriggers: { getSourcePosition: [time] },
    }),
    new LineLayer<Leg>({
      id: 'selected-done', data: sel && !sel.cancelled && time >= sel.dep ? [sel] : [],
      getSourcePosition: (l) => l.from, getTargetPosition: (l) => (planeOnSel && plane ? plane.pos : l.to),
      getColor: WHITE, getWidth: 4, updateTriggers: { getTargetPosition: [time] },
    }),
    new ScatterplotLayer<number>({
      id: 'airports', data: airports,
      getPosition: (a) => [day.airports[a].lon, day.airports[a].lat], getRadius: 4, radiusUnits: 'pixels',
      getFillColor: WHITE, stroked: true, getLineColor: [17, 24, 32, 255], getLineWidth: 2, lineWidthUnits: 'pixels',
    }),
    new IconLayer({
      id: 'plane', data: plane ? [plane] : [],
      getPosition: (d) => d.pos, getIcon: () => ({ url: PLANE, width: 64, height: 64, mask: true }),
      getSize: 28, sizeUnits: 'pixels', getAngle: (d) => -d.angle, getColor: WHITE, updateTriggers: { getAngle: [time] },
    }),
  ]

  const s = { o: f.o[selected], d: f.d[selected] }
  const labels = useMemo(() => {
    if (!viewport) return []
    // The selected leg's two airports first, then the rest; each takes the first spot that doesn't collide.
    const order = [s.o, s.d, ...airports.filter((a) => a !== s.o && a !== s.d)]
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const hit = (b: { x: number; y: number; w: number; h: number }) =>
      placed.some((o) => b.x < o.x + o.w + 4 && b.x + b.w + 4 > o.x && b.y < o.y + o.h + 4 && b.y + b.h + 4 > o.y)
    return order.map((ap) => {
      const a = day.airports[ap]
      // Project onto whichever world copy is nearest the view centre (the map repeats horizontally).
      const lon = a.lon + 360 * Math.round((view.longitude - a.lon) / 360)
      const [x, y] = viewport.project([lon, a.lat])
      const detail = ap === s.o || ap === s.d
      const w = detail ? 150 : 44, h = detail ? 40 : 18, g = 8
      const spots = [
        { x: x - w / 2, y: y - h - g }, { x: x - w / 2, y: y + g }, { x: x + g, y: y - h / 2 }, { x: x - w - g, y: y - h / 2 },
        { x: x + g, y: y - h - g }, { x: x - w - g, y: y + g }, { x: x + g, y: y + g }, { x: x - w - g, y: y - h - g },
      ]
      const spot = spots.find((p) => !hit({ ...p, w, h })) ?? spots[0]
      placed.push({ ...spot, w, h })
      return { ap, detail, box: { ...spot, w, h } }
    })
  }, [viewport, airports, day, s.o, s.d, view.longitude])

  const dep = actualDep(day, selected)
  const arr = actualArr(day, selected)
  const cancelled = f.status[selected].startsWith('C')

  return (
    <div className="flight-map" ref={wrap}>
      <DeckGL
        views={VIEW}
        viewState={view}
        onViewStateChange={({ viewState }) => setView(clampView(viewState as MapViewState))}
        controller={{ dragRotate: false, touchRotate: false }}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
        onClick={(info) => info.layer?.id === 'flown' && info.object && onSelect((info.object as Leg).i)}
        getTooltip={(info) => info.layer?.id === 'flown' && info.object ? {
          html: `<div class="tt-title">${flightLabel(day, (info.object as Leg).i)}</div>`,
          className: 'tooltip', style: { background: 'none', padding: '0' },
        } : null}
      />
      <div className="map-labels" aria-hidden>
        {labels.map(({ ap, detail, box }) => {
          const code = day.airports[ap].code
          if (!detail) return <span key={ap} className="map-label" style={{ left: box.x, top: box.y, width: box.w }}>{code}</span>
          const isOrigin = ap === s.o
          const late = isOrigin ? f.depDelay[selected] : f.arrDelay[selected]
          return (
            <div key={ap} className="map-callout" style={{ left: box.x, top: box.y, width: box.w }}>
              <div className="map-callout-head">
                <Icon icon={isOrigin ? 'map-marker' : 'flag'} size={12} />
                <strong>{code}</strong>
                <span>{isOrigin ? 'Departs' : 'Arrives'}</span>
              </div>
              <div className="map-callout-row">
                {cancelled ? 'Cancelled' : <>{clock(isOrigin ? dep : arr)}{late != null && late >= 15 && <b className="late"> +{dur(late)}</b>}</>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="map-legend">
        <span><i style={{ background: '#7b97ff' }} />On time</span>
        <span><i style={{ background: '#ffbf27' }} />15+ min late</span>
        <span><i className="sel" />Selected</span>
        <span><i className="future" />Not flown yet</span>
      </div>
      <ButtonGroup className="map-tools" vertical>
        <Button icon="zoom-in" onClick={() => setView(clampView({ ...view, zoom: view.zoom + 0.6 }))} aria-label="Zoom in" />
        <Button icon="zoom-out" onClick={() => setView(clampView({ ...view, zoom: view.zoom - 0.6 }))} aria-label="Zoom out" />
        <Button icon="zoom-to-fit" onClick={() => setFitKey((k) => k + 1)} aria-label="Fit route" />
      </ButtonGroup>
      <div className="map-credit">Imagery: NASA Blue Marble · Esri, Maxar, Earthstar Geographics</div>
    </div>
  )
}

function clampView(v: MapViewState): MapViewState {
  return { ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom)), latitude: Math.max(-70, Math.min(75, v.latitude)) }
}

/** Screen bearing (degrees clockwise from north) from a to b, good enough at map scale. */
function bearing(a: [number, number], b: [number, number]) {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return (Math.atan2(dx, b[1] - a[1]) * 180) / Math.PI
}
