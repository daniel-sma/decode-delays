import { useEffect, useState } from 'react'
import {
  Alignment, Callout, Classes, Code, H4, Icon, Navbar, NavbarDivider, NavbarGroup, NavbarHeading,
  NonIdealState, Spinner, Tag,
} from '@blueprintjs/core'
import { flightLabel, loadDay, loadSummary, route, type Day, type Summary } from './data'
import { prettyDate } from './theme'
import HomeView from './components/HomeView'
import FlightView from './components/FlightView'
import DayPicker from './components/DayPicker'

type View = { kind: 'home' } | { kind: 'flight'; index: number }

export default function App() {
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined)
  const [date, setDate] = useState<string | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [lastFlight, setLastFlight] = useState<number | null>(null)

  useEffect(() => {
    document.body.classList.add(Classes.DARK)
    // Browser back from a flight returns to the table.
    const onPop = (e: PopStateEvent) => setView(e.state?.flight != null ? { kind: 'flight', index: e.state.flight } : { kind: 'home' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    loadSummary().then((s) => {
      setSummary(s)
      if (!s) return
      // Open on the most disrupted day.
      const score = (d: string) => { const x = s.days.find((k) => k.date === d); return x ? x.delayed + 3 * x.cancelled : 0 }
      setDate([...s.availableDays].sort((a, b) => score(b) - score(a))[0])
    })
  }, [])

  useEffect(() => {
    if (!date) return
    setDay(null)
    setView({ kind: 'home' })
    setLastFlight(null)
    loadDay(date).then(setDay)
  }, [date])

  if (summary === undefined) return <div className="splash"><Spinner /></div>
  if (summary === null) return <EmptyState />

  const openFlight = (i: number) => {
    try { history.pushState({ flight: i }, '', '#flight') } catch { /* sandboxed frames may refuse */ }
    setLastFlight(i)
    setView({ kind: 'flight', index: i })
  }
  const goHome = () => {
    try { history.pushState({}, '', '#delays') } catch { /* ignore */ }
    setView({ kind: 'home' })
  }

  // Workspace tabs, as in Palantir apps: the delays table, plus the flight that's open.
  const [flightTab, setFlightTab] = [lastFlight, setLastFlight]

  return (
    <div className="app">
      <Navbar className="topbar">
        <NavbarGroup align={Alignment.START}>
          <NavbarHeading>Decode Delays</NavbarHeading>
          <NavbarDivider />
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={view.kind === 'home'} className={`ws-tab${view.kind === 'home' ? ' on' : ''}`} onClick={goHome}>
              <Icon icon="th-list" size={14} /> Biggest delays
            </button>
            {flightTab != null && day && (
              <span role="tab" aria-selected={view.kind === 'flight'} className={`ws-tab${view.kind === 'flight' ? ' on' : ''}`}>
                <button className="ws-tab-label" onClick={() => openFlight(flightTab)}>
                  <Icon icon="airplane" size={14} /> {flightLabel(day, flightTab)} · {route(day, flightTab)}
                </button>
                <button className="ws-tab-close" aria-label="Close flight" onClick={() => { setFlightTab(null); goHome() }}>
                  <Icon icon="small-cross" size={14} />
                </button>
              </span>
            )}
          </div>
        </NavbarGroup>
        <NavbarGroup align={Alignment.END}>
          {summary.synthetic && <Tag intent="warning" icon="warning-sign" className="synthetic-tag">Synthetic sample data</Tag>}
          {date && <DayPicker summary={summary} value={date} onChange={setDate} />}
        </NavbarGroup>
      </Navbar>
      {summary.synthetic && (
        <Callout intent="warning" compact className="synthetic-callout" icon="warning-sign">
          These are generated flights for previewing the design, not real data. Run <Code>npm run data</Code> to load BTS July 2026.
        </Callout>
      )}

      {!day ? (
        <div className="splash"><Spinner /><p className={Classes.TEXT_MUTED}>Loading {date && prettyDate(date)}…</p></div>
      ) : view.kind === 'home' ? (
        <HomeView day={day} onOpenFlight={openFlight} />
      ) : (
        <FlightView day={day} index={view.index} onClose={goHome} />
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
        description="Build the dataset from BTS and Iowa Mesonet:"
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
