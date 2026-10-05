import { useEffect, useState } from 'react'
import {
  Alignment, Breadcrumbs, Button, Callout, Classes, Code, Drawer, H4, Navbar, NavbarDivider, NavbarGroup, NavbarHeading,
  HTMLSelect, NonIdealState, Spinner, Tag, Tooltip, type BreadcrumbProps,
} from '@blueprintjs/core'
import { flightLabel, loadDay, loadSummary, pctTraced, route, type Day, type Summary } from './data'
import { CAT_META, prettyDate } from './theme'
import HomeView from './components/HomeView'
import FlightView from './components/FlightView'

type View = { kind: 'home' } | { kind: 'flight'; index: number }

export default function App() {
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined)
  const [date, setDate] = useState<string | null>(null)
  const [day, setDay] = useState<Day | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [about, setAbout] = useState(false)

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
      if (s) setDate(s.availableDays[0])
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
    <div className="shell">
      <nav className="rail" aria-label="App">
        <span className="logo" aria-hidden />
        <Tooltip content="Biggest delays" placement="right"><Button variant="minimal" icon="th-list" active={view.kind === 'home'} onClick={goHome} aria-label="Biggest delays" /></Tooltip>
        <Tooltip content="About the data" placement="right"><Button variant="minimal" icon="info-sign" active={about} onClick={() => setAbout(true)} aria-label="About the data" /></Tooltip>
      </nav>

      <div className="app">
        <Navbar className="topbar">
          <NavbarGroup align={Alignment.START}>
            <NavbarHeading className="brand">
              <strong>Decode Delays</strong>
              <small className={Classes.TEXT_MUTED}>Root causes of US flight delays</small>
            </NavbarHeading>
            <NavbarDivider />
            <Breadcrumbs items={crumbs} />
          </NavbarGroup>
          <NavbarGroup align={Alignment.END}>
            {summary.synthetic && <Tag intent="warning" icon="warning-sign" size="large" className="synthetic-tag">Synthetic sample data</Tag>}
            <NavbarDivider />
            <HTMLSelect
              aria-label="Day"
              value={date ?? undefined}
              onChange={(e) => setDate(e.currentTarget.value)}
              options={summary.availableDays.map((d) => {
                const s = summary.days.find((x) => x.date === d)
                return { value: d, label: `${prettyDate(d)} · ${s ? `${s.delayed.toLocaleString('en-US')} delayed` : ''}` }
              })}
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
        ) : view.kind === 'home' ? (
          <HomeView day={day} summary={summary} onDay={setDate} onOpenFlight={openFlight} />
        ) : (
          <FlightView day={day} index={view.index} />
        )}
      </div>

      <Drawer isOpen={about} onClose={() => setAbout(false)} title="About the data" icon="info-sign" size="480px" className={Classes.DARK}>
        <div className={`${Classes.DRAWER_BODY} about`}>
          <p>
            When a flight arrives 15+ minutes late, the airline must tell the Bureau of Transportation Statistics why, split
            across five causes. The biggest is usually <b>late aircraft</b>, which only means the plane arrived late from its
            previous flight. And <b>weather</b> only counts extreme weather; ordinary storms that slow air traffic are filed as <b>NAS</b>.
          </p>
          <H4>How a delay is decoded</H4>
          <ol>
            <li>Each flight is linked to the previous flight flown by the same tail number, if it left from where that one landed within 16 hours.</li>
            <li>Its late-aircraft minutes are split across the previous flight’s own decoded causes, in proportion, recursively, so delay traces several legs back.</li>
            <li>NAS and weather minutes are placed at whichever end of the flight had thunderstorms, IFR or 35 kt+ gusts on its METAR within an hour. NAS with weather on record counts as weather; otherwise it stays airspace and volume.</li>
            <li>Minutes that can’t be traced stay grey. Totals always match what airlines reported.</li>
          </ol>
          <H4>Categories</H4>
          <ul className="about-cats">
            {(['weather', 'airspace', 'airline', 'untraced'] as const).map((c) => (
              <li key={c}><i style={{ background: CAT_META[c].color }} /><div><b>{CAT_META[c].label}</b><span className={Classes.TEXT_MUTED}>{CAT_META[c].blurb}</span></div></li>
            ))}
          </ul>
          <H4>This build</H4>
          <p className={Classes.TEXT_MUTED}>
            {summary.source}. {pctTraced(summary)} of late-aircraft minutes traced to a root cause. Built{' '}
            {new Date(summary.generatedAt).toLocaleString('en-US')}.
          </p>
        </div>
      </Drawer>
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
