import { useEffect, useRef, useState } from 'react'
import {
  Alignment, Callout, Classes, Code, H4, Icon, Navbar, NavbarDivider, NavbarGroup, NavbarHeading,
  NonIdealState, Spinner, Tag,
} from '@blueprintjs/core'
import { flightLabel, loadDay, loadSummary, route, type Day, type Summary } from './data'
import { prettyDate } from './theme'
import HomeView from './components/HomeView'
import FlightView from './components/FlightView'

/** One open aircraft. `opened` is the flight it was opened on; `selected` follows the sidebar. */
interface FlightTab { id: number; tail: string; opened: number; selected: number }

export default function App() {
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined)
  const [date, setDate] = useState<string | null>(null) // the most disrupted day; there's no day picker
  const [day, setDay] = useState<Day | null>(null)
  const [tabs, setTabs] = useState<FlightTab[]>([])
  const [active, setActive] = useState<number | null>(null) // tab id, or null for the delays table
  const nextId = useRef(1)

  useEffect(() => { document.body.classList.add(Classes.DARK) }, [])

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
    setTabs([])
    setActive(null)
    loadDay(date).then(setDay)
  }, [date])

  if (summary === undefined) return <div className="splash"><Spinner /></div>
  if (summary === null) return <EmptyState />

  // Each new aircraft gets its own tab; opening a flight of an aircraft that's already open reuses that tab.
  const openFlight = (i: number) => {
    if (!day) return
    const tail = day.flights.tail[i] || `#${i}`
    const existing = tabs.find((t) => t.tail === tail)
    const id = nextId.current++ // a fresh id (re)mounts the tab on the requested flight
    if (existing) setTabs((ts) => ts.map((t) => (t.id === existing.id ? { ...t, id, opened: i, selected: i } : t)))
    else setTabs((ts) => [...ts, { id, tail, opened: i, selected: i }])
    setActive(id)
  }
  const closeTab = (id: number) => {
    const idx = tabs.findIndex((t) => t.id === id)
    const rest = tabs.filter((t) => t.id !== id)
    setTabs(rest)
    if (active === id) setActive(rest.length ? rest[Math.max(0, idx - 1)].id : null)
  }
  const current = tabs.find((t) => t.id === active)

  return (
    <div className="app">
      <Navbar className="topbar">
        <NavbarGroup align={Alignment.START} className="topbar-left">
          <NavbarHeading className="brand">
            <img src={`${import.meta.env.BASE_URL}brand/southwest-heart.png`} alt="" width={22} height={22} />
            <span>DeTrace</span>
          </NavbarHeading>
          <NavbarDivider />
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={active == null} className={`ws-tab${active == null ? ' on' : ''}`} onClick={() => setActive(null)}>
              <Icon icon="th-list" size={14} /> Biggest delays
            </button>
            {day && tabs.map((t) => (
              <span key={t.id} role="tab" aria-selected={active === t.id} className={`ws-tab${active === t.id ? ' on' : ''}`}>
                <button className="ws-tab-label" onClick={() => setActive(t.id)} title={`${t.tail} · ${route(day, t.selected)}`}>
                  <Icon icon="airplane" size={14} /> {flightLabel(day, t.selected)} · {route(day, t.selected)}
                </button>
                <button className="ws-tab-close" aria-label={`Close ${flightLabel(day, t.selected)}`} onClick={() => closeTab(t.id)}>
                  <Icon icon="small-cross" size={14} />
                </button>
              </span>
            ))}
          </div>
        </NavbarGroup>
        {summary.synthetic && (
          <NavbarGroup align={Alignment.END}>
            <Tag intent="warning" icon="warning-sign" className="synthetic-tag">Synthetic sample data</Tag>
          </NavbarGroup>
        )}
      </Navbar>
      {summary.synthetic && (
        <Callout intent="warning" compact className="synthetic-callout" icon="warning-sign">
          These are generated flights for previewing the design, not real data. Run <Code>npm run data</Code> to load BTS July 2026.
        </Callout>
      )}

      {!day ? (
        <div className="splash"><Spinner /><p className={Classes.TEXT_MUTED}>Loading {date && prettyDate(date)}…</p></div>
      ) : current ? (
        <FlightView
          key={current.id}
          day={day}
          initial={current.opened}
          onSelectedChange={(i) => setTabs((ts) => ts.map((t) => (t.id === current.id && t.selected !== i ? { ...t, selected: i } : t)))}
          onClose={() => closeTab(current.id)}
        />
      ) : (
        <HomeView day={day} onOpenFlight={openFlight} />
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
