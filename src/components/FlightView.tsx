import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from '@blueprintjs/core'
import { tailChain, type Day } from '../data'
import FlightMap from './FlightMap'
import Scrubber, { actualArr, actualDep, chainWindow } from './Scrubber'
import { FlightPanel } from './Panels'

const TICK_MS = 100 // at 1x, one simulated minute per tick

/**
 * One aircraft's page: its day on the map with a playback scrubber, the decode in the sidebar.
 * Mounted once per tab; `initial` is the flight the tab was opened on.
 */
export default function FlightView({ day, initial, onSelectedChange, onClose }: {
  day: Day
  initial: number
  onSelectedChange: (i: number) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState(initial)
  const chain = useMemo(() => tailChain(day, initial), [day, initial])
  const win = useMemo(() => chainWindow(day, chain), [day, chain])
  const [time, setTime] = useState(() => actualDep(day, initial))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [hoverLeg, setHoverLeg] = useState<number | null>(null) // leg hovered on the timeline

  useEffect(() => onSelectedChange(selected), [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setTime((t) => {
        const next = t + speed
        if (next >= win.t1) { setPlaying(false); return win.t1 }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [playing, speed, win.t1])

  // The sidebar follows whichever leg is in the air at the playhead.
  useEffect(() => {
    const f = day.flights
    const flying = chain.find((i) => !f.status[i].startsWith('C') && actualDep(day, i) <= time && time <= actualArr(day, i))
    if (flying != null && flying !== selected) setSelected(flying)
  }, [time]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (i: number) => {
    setPlaying(false)
    setSelected(i)
    if (!day.flights.status[i].startsWith('C')) setTime(actualDep(day, i))
  }

  // Up / down step through this aircraft's flights, like the sidebar list.
  const step = useRef((_d: number) => {})
  step.current = (d: number) => { const k = chain.indexOf(selected) + d; if (k >= 0 && k < chain.length) pick(chain[k]) }
  const hotkeys = useMemo(() => [
    { combo: 'up', label: 'Previous flight of this aircraft', global: true, group: 'Flight', preventDefault: true, onKeyDown: () => step.current(-1) },
    { combo: 'down', label: 'Next flight of this aircraft', global: true, group: 'Flight', preventDefault: true, onKeyDown: () => step.current(1) },
  ], [])
  useHotkeys(hotkeys)

  return (
    <main className="flight-page">
      <div className="flight-stage">
        <div className="map-wrap">
          <FlightMap day={day} chain={chain} selected={selected} time={time} onSelect={pick} />
        </div>
        <Scrubber day={day} chain={chain} win={win} time={time} playing={playing} speed={speed} onTime={setTime} onPlay={setPlaying} onSpeed={setSpeed} hoverLeg={hoverLeg} onHoverLeg={setHoverLeg} onPickLeg={pick} />
      </div>
      <aside className="panel">
        <FlightPanel day={day} index={selected} chain={chain} hovered={hoverLeg} onSelect={pick} onClose={onClose} />
      </aside>
    </main>
  )
}
