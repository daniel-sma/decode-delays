import { useEffect, useState } from 'react'
import {
  Alignment, Button, Callout, Card, Classes, Code, H4, Navbar, NavbarDivider, NavbarGroup, NavbarHeading,
  NonIdealState, SegmentedControl, Spinner, Tag,
} from '@blueprintjs/core'
import { CATS, loadDay, loadSummary, type Arc, type Day, type Summary } from './data'
import { CAT_META, prettyDate } from './theme'
import DelayMap from './components/DelayMap'
import Timeline from './components/Timeline'
import HomeView from './components/HomeView'
import { AirportPanel, ArcPanel, BackButton, FlightPanel, OverviewPanel } from './components/Panels'

export type Selection =
  | { type: 'airport'; index: number }
  | { type: 'flight'; index: number }
  | { type: 'arc'; arc: Arc }
  | null

type View = 'home' | 'map'

const MAP_CATS = CATS.filter((c) => c !== 'security')
const viewFromHash = (): View => (window.location.hash.startsWith('#/map') ? 'map' : 'home')

export default function App() {
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined)
  const [date, setDate] = useState<string | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [view, setView] = useState<View>(viewFromHash)
  const [hour, setHour] = useState<number | null>(null)
  const [mode, setMode] = useState<'origin' | 'felt'>('origin')
  const [playing, setPlaying] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)

  useEffect(() => {
    document.body.classList.add(Classes.DARK)
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (v: View) => {
    window.location.hash = v === 'map' ? '#/map' : '#/'
    setView(v)
  }

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
    setHour(null)
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

  if (summary === undefined) return <div className="splash"><Spinner /></div>
  if (summary === null) return <EmptyState />

  const openFlight = (i: number) => {
    setSelection({ type: 'flight', index: i })
    setHour(null)
    go('map')
  }

  return (
    <div className="app">
      <Navbar className="topbar">
        <NavbarGroup align={Alignment.START}>
          <NavbarHeading className="brand">
            <span className="logo" aria-hidden />
            <span>
              <strong>Decode Delays</strong>
              <small className={Classes.TEXT_MUTED}>Where US flight delays actually started</small>
            </span>
          </NavbarHeading>
          <NavbarDivider />
          <Button variant="minimal" icon="th-list" text="Biggest delays" active={view === 'home'} onClick={() => go('home')} />
          <Button variant="minimal" icon="map" text="Delay map" active={view === 'map'} onClick={() => go('map')} />
        </NavbarGroup>
        <NavbarGroup align={Alignment.END}>
          {summary.synthetic && (
            <Tag intent="warning" icon="warning-sign" size="large" className="synthetic-tag">Synthetic sample data</Tag>
          )}
          <NavbarDivider />
          <SegmentedControl
            size="small"
            value={date ?? undefined}
            onValueChange={setDate}
            options={summary.availableDays.map((d) => ({ label: prettyDate(d), value: d }))}
          />
        </NavbarGroup>
      </Navbar>
      {summary.synthetic && (
        <Callout intent="warning" compact className="synthetic-callout" icon="warning-sign">
          These are generated flights for previewing the design, not real data. Run <Code>npm run data</Code> to load BTS July 2026.
        </Callout>
      )}

      {!day ? (
        <div className="splash"><Spinner /><p className={Classes.TEXT_MUTED}>Loading {date && prettyDate(date)}…</p></div>
      ) : view === 'home' ? (
        <HomeView day={day} onOpenFlight={openFlight} />
      ) : (
        <main className="main">
          <div className="map-wrap">
            <DelayMap day={day} hour={hour} mode={mode} selection={selection} onSelect={setSelection} />
            <div className="map-overlay">
              <SegmentedControl
                className="map-mode"
                value={mode}
                onValueChange={(v) => setMode(v as 'origin' | 'felt')}
                options={[
                  { label: 'Where delay started', value: 'origin', icon: 'flag' },
                  { label: 'Where it landed', value: 'felt', icon: 'locate' },
                ]}
              />
              <Card compact className="legend">
                {MAP_CATS.map((c) => (
                  <span key={c} title={CAT_META[c].blurb}>
                    <i style={{ background: CAT_META[c].color }} />
                    {CAT_META[c].short}
                  </span>
                ))}
                <span className={`legend-note ${Classes.TEXT_MUTED}`}>Circle size = delay minutes · arcs = delay carried by aircraft</span>
              </Card>
            </div>
            <Timeline day={day} hour={hour} mode={mode} playing={playing} onHour={setHour} onPlay={setPlaying} />
          </div>

          <aside className="panel">
            {selection && <BackButton onClick={() => setSelection(null)} />}
            {!selection && <OverviewPanel day={day} summary={summary} onDay={setDate} onSelect={setSelection} />}
            {selection?.type === 'airport' && <AirportPanel day={day} index={selection.index} onSelect={setSelection} />}
            {selection?.type === 'flight' && <FlightPanel day={day} index={selection.index} onSelect={setSelection} />}
            {selection?.type === 'arc' && <ArcPanel day={day} arc={selection.arc} onSelect={setSelection} />}
          </aside>
        </main>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="splash">
      <NonIdealState
        icon="database"
        title="No data yet"
        description={<>Build the dataset from BTS and Iowa Mesonet:</>}
        action={
          <div>
            <pre className={Classes.CODE_BLOCK}>pip install -r requirements.txt{'\n'}npm run data</pre>
            <H4 className={Classes.TEXT_MUTED}>or <Code>npm run data:synthetic</Code> for a labelled offline preview</H4>
          </div>
        }
      />
    </div>
  )
}
