import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, Classes, Icon, InputGroup, NonIdealState, Section, SectionCard, Tag } from '@blueprintjs/core'
import { Cell, Column, ColumnHeaderCell, RegionCardinality, Table2, type Region } from '@blueprintjs/table'
import { CATS, delayRows, flightLabel, REPORTED, rootOf, route, sum, tailChain, topReported, type Day, type Root } from '../data'
import { CAT_META, REPORTED_META, clock, dur, fmt, pct, prettyDate } from '../theme'
import { RippleChain, Stat, statusTag } from './Panels'
import CatLabel from './CatLabel'

interface Props {
  day: Day
  onOpenFlight: (i: number) => void
}

interface Filter { cat: number | null; airport: number | null }

// Width reserved for the table's vertical scrollbar so columns never overflow sideways.
const SCROLLBAR = 16

export default function HomeView({ day, onOpenFlight }: Props) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>({ cat: null, airport: null })
  const [selected, setSelected] = useState<Region[]>([])
  const f = day.flights
  const t = day.totals

  const roots = useMemo(() => f.fn.map((_, i) => (f.otherDay[i] ? null : rootOf(day, i))), [day, f])
  const { rows: searched, tails } = useMemo(() => delayRows(day, q, 5000), [day, q])
  const rows = useMemo(() => searched.filter((i) => {
    const r = roots[i]
    if (filter.cat != null && r?.cat !== filter.cat) return false
    if (filter.airport != null && r?.airport !== filter.airport) return false
    return true
  }).slice(0, 300), [searched, roots, filter])

  useEffect(() => { setFilter({ cat: null, airport: null }); setQ('') }, [day])

  const repTotal = sum(REPORTED.map((k) => t.reported[k]))
  const delayed = useMemo(() => f.arrDelay.filter((d, i) => !f.otherDay[i] && (d ?? 0) >= 15).length, [f])
  const cancelled = sum(Object.values(t.cancelled))
  const singleTail = q.trim() && tails.length === 1 ? tails[0] : null

  const columns: { name: string; width: number; className?: string; render: (i: number) => React.ReactNode }[] = [
    { name: 'Flight', width: 92, render: (i: number) => <strong>{flightLabel(day, i)}</strong> },
    { name: 'Tail', width: 92, render: (i: number) => <span className="mono">{f.tail[i] || '—'}</span> },
    { name: 'Route', width: 112, render: (i: number) => route(day, i) },
    { name: 'Sched. dep (ET)', width: 120, render: (i: number) => clock(f.sdep[i]) },
    {
      name: 'Status', width: 110,
      render: (i: number) => statusTag(day, i),
    },
    {
      name: 'BTS reported', width: 148,
      render: (i: number) => {
        const r = topReported(day, i)
        if (!r) return <span className={Classes.TEXT_MUTED}>—</span>
        const m = REPORTED_META[r[0]]
        return <CatLabel icon={m.icon}>{m.label} <span className={Classes.TEXT_MUTED}>{pct(r[1], 1)}</span></CatLabel>
      },
    },
    {
      name: 'Decoded root cause', width: 190,
      render: (i: number) => {
        const r = roots[i]
        if (!r) return <span className={Classes.TEXT_MUTED}>—</span>
        const c = CAT_META[CATS[r.cat]]
        return <CatLabel icon={c.icon}>{c.short} at <strong>{day.airports[r.airport]?.code ?? '?'}</strong> <span className={Classes.TEXT_MUTED}>{pct(r.share, 1)}</span></CatLabel>
      },
    },
    {
      name: 'Started', width: 132,
      render: (i: number) => {
        const r = roots[i]
        if (!r) return ''
        if (CATS[r.cat] === 'untraced') return <span className={Classes.TEXT_MUTED}>Can’t trace</span>
        return r.hops === 0 ? 'On this flight' : `${r.hops} flight${r.hops > 1 ? 's' : ''} earlier`
      },
    },
  ]

  // Table2 columns are fixed-width; stretch the two cause columns so the grid fills its card.
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardWidth, setCardWidth] = useState(0)
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setCardWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const extra = Math.max(0, cardWidth - sum(columns.map((c) => c.width)) - SCROLLBAR)
  const widths = columns.map((c) => c.width + (c.name === 'BTS reported' || c.name === 'Decoded root cause' ? extra / 2 : 0))

  const onSelection = (regions: Region[]) => {
    setSelected(regions)
    const row = regions[0]?.rows?.[0]
    if (row != null && rows[row] != null) onOpenFlight(rows[row])
  }

  const filterTags = [
    filter.cat != null && <Tag key="c" size="large" onRemove={() => setFilter({ ...filter, cat: null })} icon={CAT_META[CATS[filter.cat]].icon}>Root cause: {CAT_META[CATS[filter.cat]].short}</Tag>,
    filter.airport != null && <Tag key="a" size="large" onRemove={() => setFilter({ ...filter, airport: null })} icon="map-marker">Started at {day.airports[filter.airport].code}</Tag>,
  ].filter(Boolean)

  return (
    <div className="home">
      <div className="home-main">
        <div className="kpis">
          <Stat label="Flights scheduled" value={fmt(t.flights)} />
          <Stat label="Arrived 15+ min late" value={fmt(delayed)} />
          <Stat label="Cancelled" value={fmt(cancelled)} />
          <Stat label="Delay minutes" value={fmt(repTotal)} />
          <Stat label="Filed as late aircraft" value={pct(t.reported.late, repTotal)} />
          <Stat label="Traced to weather" value={pct(t.decoded.weather, repTotal)} />
        </div>

        <RootCauseCheck day={day} roots={roots} filter={filter} onFilter={setFilter} />

        <Section
          className="home-table-section"
          title={singleTail ? `Tail ${singleTail}` : q.trim() ? `Flights matching “${q.trim()}”` : 'Biggest delays'}
          subtitle={singleTail ? 'Every flight this aircraft flew today, in order. Open one to trace it.' : 'Open a flight to see its plane’s day on the map.'}
          icon={singleTail ? 'airplane' : 'th-list'}
          rightElement={<Tag minimal>{fmt(rows.length)}{rows.length === 300 ? '+' : ''} flights</Tag>}
        >
          <SectionCard padded>
            <InputGroup
              size="large"
              leftIcon="search"
              placeholder="Search a tail number, e.g. N411WD (or a flight like DL3186)"
              value={q}
              onValueChange={(v) => { setQ(v); setSelected([]) }}
              rightElement={q ? <Button variant="minimal" icon="cross" aria-label="Clear search" onClick={() => setQ('')} /> : undefined}
              spellCheck={false}
            />
            {filterTags.length > 0 && <div className="filter-tags">{filterTags}<Button variant="minimal" size="small" text="Clear filters" onClick={() => setFilter({ cat: null, airport: null })} /></div>}
            {singleTail && rows.length > 0 && (
              <Callout className="tail-callout" icon={null} compact>
                <RippleChain day={day} chain={tailChain(day, rows[0])} selected={-1} roots={new Set()} onSelect={onOpenFlight} />
              </Callout>
            )}
          </SectionCard>
          <SectionCard padded={false} className="table-card" ref={cardRef}>
            {rows.length === 0 ? (
              <NonIdealState icon="search" title="No matching flights" description={`Nothing on ${prettyDate(day.date)} matches. Tail numbers look like N411WD.`} />
            ) : (
              <Table2
                key={Math.round(extra)}
                numRows={rows.length}
                columnWidths={widths}
                enableRowHeader={false}
                enableMultipleSelection={false}
                selectionModes={[RegionCardinality.FULL_ROWS, RegionCardinality.CELLS]}
                selectedRegionTransform={(region) => ({ rows: region.rows ?? [0, 0] })}
                selectedRegions={selected}
                onSelection={onSelection}
                defaultRowHeight={30}
                cellRendererDependencies={[rows]}
              >
                {columns.map((c) => (
                  <Column
                    key={c.name}
                    name={c.name}
                    columnHeaderCellRenderer={() => <ColumnHeaderCell name={c.name} className={c.className} />}
                    cellRenderer={(r) => <Cell className={c.className} interactive>{c.render(rows[r])}</Cell>}
                  />
                ))}
              </Table2>
            )}
          </SectionCard>
        </Section>
      </div>
    </div>
  )
}

/** Foundry-style check list: one row per root cause, with the airports behind it as filter chips. */
function RootCauseCheck({ day, roots, filter, onFilter }: {
  day: Day; roots: (Root | null)[]; filter: Filter; onFilter: (f: Filter) => void
}) {
  const groups = useMemo(() => CATS.map((_, c) => {
    const byAp = new Map<number, number>()
    let flights = 0
    roots.forEach((r) => {
      if (r?.cat !== c) return
      flights++
      byAp.set(r.airport, (byAp.get(r.airport) ?? 0) + 1)
    })
    return { c, flights, minutes: day.totals.decoded[CATS[c]], airports: [...byAp].sort((a, b) => b[1] - a[1]).slice(0, 5) }
  }).filter((g) => g.flights > 0), [day, roots])

  return (
    <Section compact title="Root causes" icon="diagnosis" subtitle="Flights by their biggest root cause · click a cause or airport to filter">
      <SectionCard padded={false}>
        <ul className="checks" style={{ ['--cols' as string]: groups.length }}>
          {groups.map((g) => {
            const meta = CAT_META[CATS[g.c]]
            const catOn = filter.cat === g.c && filter.airport == null
            return (
              <li key={g.c} className={filter.cat === g.c ? 'on' : ''}>
                <button className="check-main" aria-pressed={catOn} onClick={() => onFilter(catOn ? { cat: null, airport: null } : { cat: g.c, airport: null })}>
                  <strong><Icon icon={meta.icon} size={16} />{meta.label}</strong>
                  <span className="check-tags">
                    <Tag minimal>{fmt(g.flights)} flights</Tag>
                    <Tag minimal>{dur(g.minutes)}</Tag>
                  </span>
                </button>
                <div className="check-detail">
                  {g.airports.map(([ap, n]) => {
                    const on = filter.cat === g.c && filter.airport === ap
                    return (
                      <Tag
                        key={ap}
                        interactive
                        minimal={!on}
                        intent={on ? 'primary' : 'none'}
                        className="ap-chip"
                        onClick={() => onFilter(on ? { cat: g.c, airport: null } : { cat: g.c, airport: ap })}
                      >
                        <strong>{day.airports[ap].code}</strong> {n}
                      </Tag>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      </SectionCard>
    </Section>
  )
}
