import { useMemo, useState } from 'react'
import { route, searchFlights, flightLabel, type Day } from '../data'
import { dur } from '../theme'
import type { Selection } from '../App'

export default function Search({ day, onSelect }: { day: Day; onSelect: (s: Selection) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const hits = useMemo(() => searchFlights(day, q), [day, q])

  const pick = (i: number) => {
    onSelect({ type: 'flight', index: i })
    setOpen(false)
    setQ('')
  }

  return (
    <div className="search">
      <input
        value={q}
        placeholder="Find a flight: DL 1234 or tail N123DL"
        aria-label="Search flights"
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(hits.length - 1, a + 1))
          if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
          if (e.key === 'Enter' && hits[active] != null) pick(hits[active])
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && q.length >= 2 && (
        <ul className="search-results">
          {hits.length === 0 && <li className="none">No flights match “{q}” on this day</li>}
          {hits.map((i, k) => (
            <li key={i}>
              <button className={k === active ? 'on' : ''} onMouseDown={() => pick(i)}>
                <b>{flightLabel(day, i)}</b>
                <span>{route(day, i)} · {day.flights.tail[i]}</span>
                <span className="fl-delay">
                  {day.flights.status[i].startsWith('C') ? 'Cancelled' : day.flights.arrDelay[i] != null ? `+${dur(Math.max(0, day.flights.arrDelay[i]!))}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
