import { useEffect, useState } from 'react'
import { CATS, loadDay, loadSummary, type Arc, type Day, type Summary } from './data'
import { CAT_META, prettyDate } from './theme'
import DelayMap from './components/DelayMap'
import Timeline from './components/Timeline'
import Search from './components/Search'
import { AirportPanel, ArcPanel, FlightPanel, OverviewPanel } from './components/Panels'

export type Selection =
  | { type: 'airport'; index: number }
  | { type: 'flight'; index: number }
  | { type: 'arc'; arc: Arc }
  | null

const MAP_CATS = CATS.filter((c) => c !== 'security')

export default function App() {
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined)
  const [date, setDate] = useState<string | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [hour, setHour] = useState<number | null>(null)
  const [mode, setMode] = useState<'origin' | 'felt'>('origin')
  const [playing, setPlaying] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)

  useEffect(() => {
    loadSummary().then((s) => {
      setSummary(s)
      if (s) setDate(s.availableDays[0])
    })
  }, [])

  useEffect(() => {
    if (!date) return
    setDay(null)
    setSelection(null)
    loadDay(date).then(setDay)
  }, [date])

  useEffect(() => {
    if (!playing || !day) return
    const id = setInterval(() => {
      setHour((h) => {
        const next = h == null ? 5 : h + 1
        if (next >= day.hours) {
          setPlaying(false)
          return null
        }
        return next
      })
    }, 700)
    return () => clearInterval(id)
  }, [playing, day])

  if (summary === undefined) return <div className="splash">Loading…</div>
  if (summary === null) return <EmptyState />

  return (
    <div className="app">
      {summary.synthetic && (
        <div className="synthetic-banner" role="alert">
          Synthetic sample data, not real flights. Run <code>npm run data</code> to load BTS July 2026.
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          <div>
            <h1>Decode Delays</h1>
            <p>Where US flight delays actually started</p>
          </div>
        </div>
        <nav className="days" aria-label="Day">
          {summary.availableDays.map((d) => (
            <button key={d} className={d === date ? 'on' : ''} onClick={() => setDate(d)}>
              {prettyDate(d)}
            </button>
          ))}
        </nav>
        {day && <Search day={day} onSelect={setSelection} />}
      </header>

      <main className="main">
        <div className="map-wrap">
          {day ? (
            <DelayMap day={day} hour={hour} mode={mode} selection={selection} onSelect={setSelection} />
          ) : (
            <div className="splash">Loading {date}…</div>
          )}
          <div className="map-overlay">
            <div className="seg-toggle" role="radiogroup" aria-label="Map shows">
              <button role="radio" aria-checked={mode === 'origin'} className={mode === 'origin' ? 'on' : ''} onClick={() => setMode('origin')}>
                Where delay started
              </button>
              <button role="radio" aria-checked={mode === 'felt'} className={mode === 'felt' ? 'on' : ''} onClick={() => setMode('felt')}>
                Where it landed
              </button>
            </div>
            <div className="legend">
              {MAP_CATS.map((c) => (
                <span key={c} title={CAT_META[c].blurb}>
                  <i style={{ background: CAT_META[c].color }} />
                  {CAT_META[c].short}
                </span>
              ))}
              <span className="legend-note">Circle size = delay minutes · arcs = delay carried by aircraft</span>
            </div>
          </div>
          {day && (
            <Timeline day={day} hour={hour} mode={mode} playing={playing} onHour={setHour} onPlay={setPlaying} />
          )}
        </div>

        <aside className="panel">
          {selection && (
            <button className="back" onClick={() => setSelection(null)}>
              ← Day overview
            </button>
          )}
          {day && !selection && <OverviewPanel day={day} summary={summary} onDay={setDate} onSelect={setSelection} />}
          {day && selection?.type === 'airport' && <AirportPanel day={day} index={selection.index} onSelect={setSelection} />}
          {day && selection?.type === 'flight' && <FlightPanel day={day} index={selection.index} onSelect={setSelection} />}
          {day && selection?.type === 'arc' && <ArcPanel day={day} arc={selection.arc} onSelect={setSelection} />}
        </aside>
      </main>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="splash empty">
      <h1>No data yet</h1>
      <p>Build the dataset from BTS and Iowa Mesonet:</p>
      <pre>pip install -r requirements.txt{'\n'}npm run data</pre>
      <p className="hint">Or <code>npm run data:synthetic</code> for an offline preview (clearly labelled, not real).</p>
    </div>
  )
}
