import { useEffect, useMemo, useState } from 'react'
import { tailChain, type Day } from '../data'
import FlightMap from './FlightMap'
import Scrubber, { actualArr, actualDep, chainWindow } from './Scrubber'
import { FlightPanel } from './Panels'

const TICK_MS = 100 // at 1x, one simulated minute per tick

/** One flight's page: its aircraft's day on the map with a playback scrubber, the decode in the sidebar. */
export default function FlightView({ day, index, onClose }: { day: Day; index: number; onClose: () => void }) {
  const [selected, setSelected] = useState(index)
  const chain = useMemo(() => tailChain(day, index), [day, index])
  const win = useMemo(() => chainWindow(day, chain), [day, chain])
  const [time, setTime] = useState(() => actualDep(day, index))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)

  // Opening a different flight resets the page to that flight's departure.
  useEffect(() => {
    setSelected(index)
    setTime(actualDep(day, index))
    setPlaying(false)
  }, [day, index])

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

  return (
    <main className="flight-page">
      <div className="flight-stage">
        <div className="map-wrap">
          <FlightMap day={day} chain={chain} selected={selected} time={time} onSelect={pick} />
        </div>
        <Scrubber day={day} chain={chain} win={win} time={time} playing={playing} speed={speed} onTime={setTime} onPlay={setPlaying} onSpeed={setSpeed} />
      </div>
      <aside className="panel">
        <FlightPanel day={day} index={selected} chain={chain} onSelect={pick} onClose={onClose} />
      </aside>
    </main>
  )
}
