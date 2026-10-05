import { useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { MapView, WebMercatorViewport, type MapViewState } from '@deck.gl/core'
import { GeoJsonLayer, IconLayer, LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { Button, ButtonGroup, Icon } from '@blueprintjs/core'
import { feature, mesh } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import statesTopo from 'us-atlas/states-10m.json'
// Natural Earth countries at 1:50m, emitted as its own file and fetched, so it stays out of the JS bundle.
import worldUrl from 'world-atlas/countries-50m.json?url'
import { flightLabel, type Day } from '../data'
import { clock, dur } from '../theme'
import { actualArr, actualDep } from './Scrubber'

const topo = statesTopo as unknown as Topology
const states = feature(topo, topo.objects.states)

// Dark vector basemap: near-black water (the map frame behind the canvas), dark land, faint borders and
// water-body labels, so the routes are the brightest thing on the map.
const LAND: RGBA = [21, 21, 21, 255] // #151515
const COAST: RGBA = [255, 255, 255, 26]
const BORDER: RGBA = [255, 255, 255, 46]
const STATE: RGBA = [255, 255, 255, 22]
const WATER_LABEL: RGBA = [255, 255, 255, 64]
const WATER_LABELS: { text: string; at: [number, number] }[] = [
  { text: 'North\nAtlantic\nOcean', at: [-45, 33] },
  { text: 'North\nPacific\nOcean', at: [-142, 30] },
  { text: 'Gulf of\nMexico', at: [-90.5, 25.3] },
  { text: 'Caribbean Sea', at: [-75, 15] },
  { text: 'Hudson\nBay', at: [-85.5, 59.5] },
]

// Place names: countries, and US states from STATE_ZOOM in (when the US name gives way to them). A name
// shows only if its place is about as wide as the text on screen and it doesn't overlap a bigger place's
// name or an airport (see `places` below).
const COUNTRY_LABEL: RGBA = [255, 255, 255, 110]
const STATE_LABEL: RGBA = [255, 255, 255, 80]
const STATE_ZOOM = 3.2
const US = 'United States of America'
const SHORT_NAMES: Record<string, string> = { [US]: 'United States', 'Dominican Rep.': 'Dominican Rep.', 'Bosnia and Herz.': 'Bosnia', 'Central African Rep.': 'C. African Rep.' }
// Where the largest polygon's centre falls badly (water, or the wrong side of a bay).
const LABEL_AT: Record<string, [number, number]> = {
  Canada: [-104, 57], [US]: [-98.5, 39.5], Florida: [-81.6, 28.2], Michigan: [-84.7, 43.4], Louisiana: [-92.4, 31.1],
  Maryland: [-76.9, 39.4], Virginia: [-78.6, 37.6], Massachusetts: [-71.9, 42.35], 'New York': [-75.2, 42.9], Kentucky: [-85.3, 37.5],
  Norway: [9, 61.5], Chile: [-71, -30], Russia: [95, 62], Indonesia: [114, -1], Japan: [138.5, 36.5], Malaysia: [102, 4.2],
}
interface PlaceLabel { name: string; at: [number, number]; area: number; country: boolean; box: [number, number, number, number] }

/** Planar area and centroid of a ring in lon/lat (shoelace); good enough to place a label. */
function ringStats(ring: number[][]) {
  let a = 0, x = 0, y = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f
  }
  const lons = ring.map((c) => c[0]), lats = ring.map((c) => c[1])
  const box: [number, number, number, number] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
  return { area: a ? Math.abs(a / 2) : 0, at: (a ? [x / (3 * a), y / (3 * a)] : ring[0]) as [number, number], box }
}

/** One label per feature, at the centre of its largest polygon unless LABEL_AT says otherwise. */
function placeLabels(fc: GeoJSON.FeatureCollection, country: boolean): PlaceLabel[] {
  const out: PlaceLabel[] = []
  for (const f of fc.features) {
    const name = f.properties?.name as string | undefined
    const g = f.geometry
    if (!name || !g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    let best = ringStats(polys[0][0]), total = 0
    for (const p of polys) { const r = ringStats(p[0]); total += r.area; if (r.area > best.area) best = r }
    out.push({ name: SHORT_NAMES[name] ?? name, at: LABEL_AT[name] ?? best.at, area: total, country, box: best.box })
  }
  return out
}
const stateLabels = placeLabels(states as GeoJSON.FeatureCollection, false)

interface World { land: GeoJSON.FeatureCollection; borders: GeoJSON.MultiLineString; coast: GeoJSON.MultiLineString; labels: PlaceLabel[] }
let worldCache: Promise<World> | null = null
function loadWorld(): Promise<World> {
  worldCache ??= fetch(worldUrl).then((r) => r.json()).then((t: Topology) => {
    const countries = t.objects.countries as GeometryCollection
    return {
      land: feature(t, countries) as GeoJSON.FeatureCollection,
      borders: mesh(t, countries, (a, b) => a !== b),
      coast: mesh(t, countries, (a, b) => a === b),
      labels: placeLabels(feature(t, countries) as GeoJSON.FeatureCollection, true),
    }
  })
  return worldCache
}
const MIN_ZOOM = 1.6 // the whole world fills the view; no empty space past the poles
const MAX_ZOOM = 9
// Repeat the world horizontally so panning past the antimeridian never shows empty space.
const VIEW = new MapView({ repeat: true })

type RGBA = [number, number, number, number]
// Leg colours match the sidebar's status tags: on time, 15+ min late, 3h+ late.
const ON_TIME: RGBA = [85, 168, 122, 255] // --on-time
const LATE: RGBA = [201, 150, 85, 255] // --late
const SEVERE: RGBA = [201, 104, 112, 255] // --severe
const SEVERE_MIN = 180 // same threshold as statusTag
const WHITE: RGBA = [241, 241, 242, 255] // --map-selected
// Map marker: the plane artwork faces east (nose right), so it turns by 90° less than the bearing.
const PLANE = `${import.meta.env.BASE_URL}brand/plane.png`
const PLANE_HEADING = 90
// Airport pin on the map: an icon tile and the tail under it that points at the airport
const PIN = 26
const PIN_TAIL = 6

const FONT = getComputedStyle(document.body).fontFamily
const COUNTRY_SIZE = 12
const STATE_SIZE = 11

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
  late: number // arrival delay, minutes
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
  const [world, setWorld] = useState<World | null>(null)
  const [hoverAp, setHoverAp] = useState<number | null>(null) // airport under the pointer
  const [tapAp, setTapAp] = useState<number | null>(null) // airport whose pin was tapped (touch screens have no hover)
  useEffect(() => { loadWorld().then(setWorld).catch(() => {}) }, [])

  const legs = useMemo<Leg[]>(() => chain.map((i) => {
    const o = day.airports[f.o[i]], d = day.airports[f.d[i]]
    return {
      i, from: [o.lon, o.lat], to: [d.lon, d.lat], late: f.arrDelay[i] ?? 0,
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

  const s = { o: f.o[selected], d: f.d[selected] }
  // Cards for the selected leg's airports show only while hovered.
  const cardAps = [s.o, s.d].filter((ap) => ap === hoverAp || ap === tapAp)
  const labels = useMemo(() => {
    if (!viewport) return []
    // Pins first (an icon tile whose tail points at the airport), then every airport code, then any open card;
    // each takes the first spot that doesn't collide, so opening a card never moves the codes.
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const hit = (b: { x: number; y: number; w: number; h: number }) =>
      placed.some((o) => b.x < o.x + o.w + 4 && b.x + b.w + 4 > o.x && b.y < o.y + o.h + 4 && b.y + b.h + 4 > o.y)
    // Project onto whichever world copy is nearest the view centre (the map repeats horizontally).
    const at = (ap: number) => {
      const a = day.airports[ap]
      return viewport.project([a.lon + 360 * Math.round((view.longitude - a.lon) / 360), a.lat])
    }
    const pins = [s.o, s.d].map((ap) => { const [x, y] = at(ap); return { x: x - PIN / 2, y: y - PIN - PIN_TAIL, w: PIN, h: PIN + PIN_TAIL } })
    placed.push(...pins)
    const place = (ap: number, card: boolean) => {
      const [x, y] = at(ap)
      const pinned = ap === s.o || ap === s.d
      const w = card ? 196 : 44, h = card ? 44 : 18, g = 8
      const side = pinned ? PIN / 2 + g : g // codes and cards sit beside a pin, not under it
      const spots = card
        ? [
            { x: x + side, y: y - h }, { x: x - side - w, y: y - h }, { x: x - w / 2, y: y + g },
            { x: x + g, y: y + g }, { x: x - w - g, y: y + g }, { x: x - w / 2, y: y - PIN - PIN_TAIL - h - g },
          ]
        : [
            ...(pinned ? [] : [{ x: x - w / 2, y: y - h - g }]), { x: x - w / 2, y: y + g }, { x: x + side, y: y - h / 2 },
            { x: x - side - w, y: y - h / 2 }, { x: x + side, y: y - h - g }, { x: x - w - g, y: y + g }, { x: x + g, y: y + g },
            { x: x - w - side, y: y - h - g },
          ]
      // Prefer spots fully inside the map (cards must never run off the edge), then ones that don't collide.
      const inside = (p: { x: number; y: number }) => p.x >= 4 && p.y >= 4 && p.x + w <= size.width - 4 && p.y + h <= size.height - 4
      const fits = card ? spots.filter(inside) : spots
      const clampIn = (p: { x: number; y: number }) => ({ x: Math.max(4, Math.min(size.width - w - 4, p.x)), y: Math.max(4, Math.min(size.height - h - 4, p.y)) })
      const spot = fits.find((p) => !hit({ ...p, w, h })) ?? fits[0] ?? (card ? clampIn(spots[0]) : spots[0])
      placed.push({ ...spot, w, h })
      return { ap, detail: card, box: { ...spot, w, h }, pin: card ? null : pinned ? pins[ap === s.o ? 0 : 1] : null }
    }
    const codes = airports.map((ap) => place(ap, false))
    const cards = cardAps.map((ap) => place(ap, true))
    return [...codes.filter((c) => !cardAps.includes(c.ap)), ...cards]
  }, [viewport, airports, day, s.o, s.d, view.longitude, cardAps.join(), size])  // eslint-disable-line react-hooks/exhaustive-deps

  // Place names that fit: biggest places first; each needs room on screen and must not overlap a name already
  // placed or an airport dot and its code.
  const places = useMemo(() => {
    if (!viewport || !world) return []
    const showStates = view.zoom >= STATE_ZOOM
    const near = (lon: number) => lon + 360 * Math.round((view.longitude - lon) / 360)
    // Airport dots and their code / detail cards are taken first.
    const taken = labels.flatMap(({ ap, box, pin }) => {
      const [x, y] = viewport.project([near(day.airports[ap].lon), day.airports[ap].lat])
      return [box, { x: x - 8, y: y - 8, w: 16, h: 16 }, ...(pin ? [pin] : [])]
    })
    const cands = [
      ...world.labels.filter((l) => !(showStates && l.name === 'United States')),
      ...(showStates ? stateLabels : []),
    ].sort((a, b) => Number(b.country) - Number(a.country) || b.area - a.area)
    const out: PlaceLabel[] = []
    for (const l of cands) {
      const fs = l.country ? COUNTRY_SIZE : STATE_SIZE
      const w = l.name.length * fs * (l.country ? 0.68 : 0.56), h = fs + 4
      const [x0] = viewport.project([near(l.box[0]), l.box[1]]), [x1] = viewport.project([near(l.box[2]), l.box[3]])
      if (Math.abs(x1 - x0) < w * 0.75) continue // the place is too small for its name at this zoom
      const [x, y] = viewport.project([near(l.at[0]), l.at[1]])
      if (x < -w || x > size.width + w || y < -h || y > size.height + h) continue
      const b = { x: x - w / 2 - 4, y: y - h / 2 - 2, w: w + 8, h: h + 4 }
      if (taken.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)) continue
      taken.push(b)
      out.push(l)
    }
    return out
  }, [viewport, world, view.zoom, view.longitude, labels, day])
  const layers = [
    new GeoJsonLayer({ id: 'land', data: world?.land, filled: true, stroked: false, getFillColor: LAND }),
    new GeoJsonLayer({ id: 'coast', data: world?.coast, stroked: true, getLineColor: COAST, lineWidthUnits: 'pixels', getLineWidth: 1 }),
    new GeoJsonLayer({ id: 'states', data: states, filled: false, stroked: true, getLineColor: STATE, lineWidthUnits: 'pixels', getLineWidth: 1 }),
    new GeoJsonLayer({ id: 'borders', data: world?.borders, stroked: true, getLineColor: BORDER, lineWidthUnits: 'pixels', getLineWidth: 1 }),
    new TextLayer({
      id: 'water-labels', data: WATER_LABELS, getPosition: (d) => d.at, getText: (d) => d.text,
      getColor: WATER_LABEL, getSize: 15, lineHeight: 1.15, fontFamily: FONT, fontWeight: 400,
      characterSet: 'auto',
    }),
    new TextLayer<PlaceLabel>({
      id: 'country-labels', data: places.filter((l) => l.country),
      getPosition: (d) => d.at, getText: (d) => d.name.toUpperCase(), getColor: COUNTRY_LABEL, getSize: COUNTRY_SIZE,
      fontFamily: FONT, fontWeight: 600, characterSet: 'auto',
    }),
    new TextLayer<PlaceLabel>({
      id: 'state-labels', data: places.filter((l) => !l.country),
      getPosition: (d) => d.at, getText: (d) => d.name, getColor: STATE_LABEL, getSize: STATE_SIZE,
      fontFamily: FONT, fontWeight: 400, characterSet: 'auto',
    }),
    // Legs still to fly are dashed, like a planned route.
    new LineLayer<Leg, { getDashArray: [number, number] }>({
      id: 'upcoming', data: upcoming, getSourcePosition: (l) => l.from, getTargetPosition: (l) => l.to,
      getColor: [241, 241, 242, 102], getWidth: 1.5,
      extensions: [new PathStyleExtension({ dash: true })], getDashArray: [6, 5],
    }),
    new LineLayer<Leg>({
      id: 'flown', data: flown, getSourcePosition: (l) => l.from, getTargetPosition: (l) => l.to,
      getColor: (l) => (l.late >= SEVERE_MIN ? SEVERE : l.late >= 15 ? LATE : ON_TIME), getWidth: 3, pickable: true, autoHighlight: true, highlightColor: [241, 241, 242, 160],
    }),
    // Selected leg: dashed ahead of the plane, solid behind it.
    new LineLayer<Leg, { getDashArray: [number, number] }>({
      id: 'selected-ahead', data: sel && !sel.cancelled && time < sel.arr ? [sel] : [],
      getSourcePosition: (l) => (planeOnSel && plane ? plane.pos : l.from), getTargetPosition: (l) => l.to,
      getColor: [241, 241, 242, 210], getWidth: 2,
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
      getFillColor: WHITE, stroked: true, getLineColor: [11, 11, 11, 255], getLineWidth: 2, lineWidthUnits: 'pixels',
      pickable: true, radiusMinPixels: 4, onHover: (info) => setHoverAp(info.object ?? null),
    }),
    new IconLayer({
      id: 'plane', data: plane ? [plane] : [],
      getPosition: (d) => d.pos, getIcon: () => ({ url: PLANE, width: 256, height: 256, mask: false }),
      getSize: 40, sizeUnits: 'pixels', getAngle: (d) => PLANE_HEADING - d.angle, updateTriggers: { getAngle: [time] },
    }),
  ]


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
        onClick={(info) => {
          // Tapping an airport dot toggles its card (no hover on touch screens); tapping elsewhere closes it.
          const ap = info.layer?.id === 'airports' ? (info.object as number) : null
          setTapAp((t) => (ap != null && t !== ap ? ap : null))
          if (info.layer?.id === 'flown' && info.object) onSelect((info.object as Leg).i)
        }}
        getTooltip={(info) => info.layer?.id === 'flown' && info.object ? {
          html: `<div class="tt-title">${flightLabel(day, (info.object as Leg).i)}</div>`,
          className: 'tooltip', style: { background: 'none', padding: '0' },
        } : null}
      />
      <div className="map-labels" aria-hidden>
        {viewport && [s.o, s.d].map((ap) => {
          const a = day.airports[ap]
          const [x, y] = viewport.project([a.lon + 360 * Math.round((view.longitude - a.lon) / 360), a.lat])
          return (
            <span
              key={`pin-${ap}`} className={`map-pin${cardAps.includes(ap) ? ' on' : ''}`} style={{ left: x - PIN / 2, top: y - PIN - PIN_TAIL }}
              onPointerEnter={(e) => e.pointerType !== 'touch' && setHoverAp(ap)} onPointerLeave={() => setHoverAp(null)}
              onClick={() => setTapAp((t) => (t === ap ? null : ap))}
            >
              <Icon icon={ap === s.o ? 'map-marker' : 'flag'} size={14} />
            </span>
          )
        })}
        {labels.map(({ ap, detail, box }) => {
          const code = day.airports[ap].code
          if (!detail) return <span key={ap} className="map-label" style={{ left: box.x, top: box.y, width: box.w }}>{code}</span>
          const isOrigin = ap === s.o
          const late = isOrigin ? f.depDelay[selected] : f.arrDelay[selected]
          return (
            <div key={ap} className="map-callout" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
              <span className="map-callout-icon"><Icon icon={isOrigin ? 'map-marker' : 'flag'} size={14} /></span>
              <span className="map-callout-text">
                <span className="map-callout-head"><strong>{code}</strong><span>{isOrigin ? 'Departs' : 'Arrives'}</span></span>
                <span className="map-callout-row">
                  {cancelled ? 'Cancelled' : <>{clock(isOrigin ? dep : arr)}{late != null && late >= 15 && <b className={late >= SEVERE_MIN ? 'late severe' : 'late'}> +{dur(late)}</b>}</>}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <div className="map-legend">
        <span><i style={{ background: '#55a87a' }} />On time</span>
        <span><i style={{ background: '#c99655' }} />15+ min late</span>
        <span><i style={{ background: '#c96870' }} />3h+ late</span>
        <span><i className="sel" />Selected</span>
        <span><i className="future" />Not flown yet</span>
      </div>
      <ButtonGroup className="map-tools" vertical>
        <Button icon="zoom-in" onClick={() => setView(clampView({ ...view, zoom: view.zoom + 0.6 }))} aria-label="Zoom in" />
        <Button icon="zoom-out" onClick={() => setView(clampView({ ...view, zoom: view.zoom - 0.6 }))} aria-label="Zoom out" />
        <Button icon="zoom-to-fit" onClick={() => setFitKey((k) => k + 1)} aria-label="Fit route" />
      </ButtonGroup>
      <div className="map-credit">Natural Earth</div>
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
