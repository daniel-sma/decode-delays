import { useEffect, useState } from 'react'
import {
  Alignment, Breadcrumbs, Callout, Classes, Code, H4, Navbar, NavbarDivider, NavbarGroup, NavbarHeading,
  NonIdealState, Spinner, Tag, type BreadcrumbProps,
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
    loadDay(date).then(setDay)
  }, [date])

  if (summary === undefined) return <div className="splash"><Spinner /></div>
  if (summary === null) return <EmptyState />

  const openFlight = (i: number) => {
    try { history.pushState({ flight: i }, '', '#flight') } catch { /* sandboxed frames may refuse */ }
    setView({ kind: 'flight', index: i })
  }
  const goHome = () => {
    try { history.pushState({}, '', '#delays') } catch { /* ignore */ }
    setView({ kind: 'home' })
  }

  const crumbs: BreadcrumbProps[] = [{ text: 'Biggest delays', icon: 'th-list', onClick: goHome }]
  if (view.kind === 'flight' && day) {
    crumbs.push({ text: `${flightLabel(day, view.index)} · ${route(day, view.index)}`, icon: 'airplane', current: true })
  }

  return (
    <div className="app">
      <Navbar className="topbar">
        <NavbarGroup align={Alignment.START}>
          <NavbarHeading>Decode Delays</NavbarHeading>
          <NavbarDivider />
          <Breadcrumbs items={crumbs} />
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
        <FlightView day={day} index={view.index} />
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
