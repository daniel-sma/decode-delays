import { useEffect, useMemo, useState } from 'react'
import { tailChain, type Day } from '../data'
import FlightMap from './FlightMap'
import { FlightPanel } from './Panels'

/** One flight's page: its aircraft's day on the map, the decode in the sidebar. */
export default function FlightView({ day, index }: { day: Day; index: number }) {
  const [selected, setSelected] = useState(index)
  useEffect(() => setSelected(index), [index])
  const chain = useMemo(() => tailChain(day, selected), [day, selected])

  return (
    <main className="main">
      <div className="map-wrap">
        <FlightMap day={day} chain={chain} selected={selected} onSelect={setSelected} />
      </div>
      <aside className="panel">
        <FlightPanel day={day} index={selected} chain={chain} onSelect={setSelected} />
      </aside>
    </main>
  )
}
