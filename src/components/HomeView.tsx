import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, Classes, Icon, InputGroup, NonIdealState, Section, SectionCard } from '@blueprintjs/core'
import { Cell, Column, ColumnHeaderCell, RegionCardinality, Table2, type Region } from '@blueprintjs/table'
import { CATS, flightLabel, REPORTED, rootOf, route, sum, tailChain, topReported, type Day } from '../data'
import { CAT_META, COST_NOTE, COST_PER_MIN, REPORTED_META, clock, fmt, money, pct, prettyDate } from '../theme'
import { RippleChain, Stat, statusTag } from './Panels'
import CatLabel from './CatLabel'
import { RootCauseMenu, SearchFilterMenu, SimpleFilterMenu, type Choice } from './HeaderMenus'

interface Props {
  day: Day
  onOpenFlight: (i: number) => void
}

type Status = 'delayed' | 'severe' | 'ontime' | 'cancelled' | 'all'
interface Filter { cat: number | null; airport: number | null; status: Status; at: number | null }
const NO_FILTER: Filter = { cat: null, airport: null, status: 'delayed', at: null }
const STATUS: Choice<Status>[] = [
  { value: 'delayed', label: 'Delayed 15+ min' }, { value: 'severe', label: 'Delayed 3h+' },
  { value: 'cancelled', label: 'Cancelled' }, { value: 'ontime', label: 'On time' }, { value: 'all', label: 'All flights' },
]

// Width reserved for the table's vertical scrollbar so columns never overflow sideways.
const SCROLLBAR = 16

interface Col {
  name: string
  width: number
  className?: string
  render: (i: number) => React.ReactNode
  /** Blueprint header menu used as this column's filter */
  menu?: () => React.JSX.Element
  filtered?: boolean
}

export default function HomeView({ day, onOpenFlight }: Props) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const [selected, setSelected] = useState<Region[]>([])
  const f = day.flights
  const t = day.totals

  const roots = useMemo(() => f.fn.map((_, i) => (f.otherDay[i] ? null : rootOf(day, i))), [day, f])
  const query = q.trim().toUpperCase().replace(/\s+/g, '')
  const { rows, tails } = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < f.fn.length; i++) {
      if (f.otherDay[i]) continue
      if (query) {
        const label = f.carrier[i] + f.fn[i]
        if (!(f.tail[i].toUpperCase().startsWith(query) || label === query || f.fn[i] === query || (query.length >= 3 && label.startsWith(query)))) continue
      }
      const a = f.arrDelay[i] ?? 0, c = f.status[i].startsWith('C')
      // A search shows every matching flight unless a status is chosen explicitly.
      const status = query && filter.status === 'delayed' ? 'all' : filter.status
      if (status === 'delayed' && (c || a < 15)) continue
      if (status === 'severe' && (c || a < 180)) continue
      if (status === 'ontime' && (c || a >= 15)) continue
      if (status === 'cancelled' && !c) continue
      if (filter.at != null && f.o[i] !== filter.at && f.d[i] !== filter.at) continue
      const r = roots[i]
      if (filter.cat != null && r?.cat !== filter.cat) continue
      if (filter.airport != null && r?.airport !== filter.airport) continue
      out.push(i)
    }
    const tails = query ? [...new Set(out.map((i) => f.tail[i]))] : []
    // One aircraft reads best in flight order; everything else worst first, cancellations after delays.
    if (tails.length === 1) out.sort((x, y) => f.sdep[x] - f.sdep[y])
    else out.sort((x, y) => (f.arrDelay[y] ?? -1) - (f.arrDelay[x] ?? -1))
    return { rows: out, tails }
  }, [f, query, filter, roots])

  const airportsUsed = useMemo(() => {
    const m = new Map<number, number>()
    f.o.forEach((o, i) => { if (!f.otherDay[i]) { m.set(o, (m.get(o) ?? 0) + 1); m.set(f.d[i], (m.get(f.d[i]) ?? 0) + 1) } })
    return [...m].sort((a, b) => b[1] - a[1])
  }, [f])
  const rootAirports = useMemo(() => {
    const m = new Map<number, number>()
    roots.forEach((r) => { if (r && (filter.cat == null || r.cat === filter.cat)) m.set(r.airport, (m.get(r.airport) ?? 0) + 1) })
    return [...m].sort((a, b) => b[1] - a[1])
  }, [roots, filter.cat])
  const filtersSet = filter.cat != null || filter.airport != null || filter.at != null || filter.status !== 'delayed'

  useEffect(() => { setFilter(NO_FILTER); setQ('') }, [day])

  const repTotal = sum(REPORTED.map((k) => t.reported[k]))
  const delayed = useMemo(() => f.arrDelay.filter((d, i) => !f.otherDay[i] && (d ?? 0) >= 15).length, [f])
  const cancelled = sum(Object.values(t.cancelled))
  const singleTail = q.trim() && tails.length === 1 ? tails[0] : null
  const cost = (min: number) => money(min * COST_PER_MIN)

  const columns: Col[] = [
    { name: 'Flight', width: 92, render: (i) => <strong>{flightLabel(day, i)}</strong> },
    { name: 'Tail', width: 92, render: (i) => <span className="mono">{f.tail[i] || '—'}</span> },
    {
      name: 'Route', width: 120, render: (i) => route(day, i), filtered: filter.at != null,
      menu: () => (
        <SearchFilterMenu<number | null>
          title="Airport (origin or destination)" placeholder="Search airports" value={filter.at}
          onPick={(at) => setFilter({ ...filter, at })}
          items={[{ value: null, label: 'Any airport' }, ...airportsUsed.map(([a, n]) => ({ value: a, label: day.airports[a].code, count: n }))]}
        />
      ),
    },
    { name: 'Sched. dep (ET)', width: 120, render: (i) => clock(f.sdep[i]) },
    {
      name: 'Status', width: 116, render: (i) => statusTag(day, i), filtered: filter.status !== 'delayed',
      menu: () => <SimpleFilterMenu<Status> title="Status" items={STATUS} value={filter.status} onPick={(status) => setFilter({ ...filter, status })} />,
    },
    {
      name: 'Delay cost', width: 104, className: 'num',
      render: (i) => ((f.arrDelay[i] ?? 0) >= 15 ? <span className="mono">{money((f.arrDelay[i] ?? 0) * COST_PER_MIN, true)}</span> : <span className={Classes.TEXT_MUTED}>—</span>),
    },
    {
      name: 'BTS reported', width: 148,
      render: (i) => {
        const r = topReported(day, i)
        if (!r) return <span className={Classes.TEXT_MUTED}>—</span>
        const m = REPORTED_META[r[0]]
        return <CatLabel icon={m.icon}>{m.label} <span className={Classes.TEXT_MUTED}>{pct(r[1], 1)}</span></CatLabel>
      },
    },
    {
      name: 'Decoded root cause', width: 190, filtered: filter.cat != null || filter.airport != null,
      render: (i) => {
        const r = roots[i]
        if (!r) return <span className={Classes.TEXT_MUTED}>—</span>
        const c = CAT_META[CATS[r.cat]]
        return <CatLabel icon={c.icon}>{c.short} at <strong>{day.airports[r.airport]?.code ?? '?'}</strong> <span className={Classes.TEXT_MUTED}>{pct(r.share, 1)}</span></CatLabel>
      },
      menu: () => (
        <RootCauseMenu<number | null, number | null>
          causes={[{ value: null, label: 'Any root cause' }, ...CATS.map((c, k) => ({ value: k, label: CAT_META[c].label, icon: CAT_META[c].icon }))]}
          cause={filter.cat} onCause={(cat) => setFilter({ ...filter, cat, airport: null })}
          airports={[{ value: null, label: 'Anywhere' }, ...rootAirports.map(([a, n]) => ({ value: a, label: day.airports[a].code, count: n }))]}
          airport={filter.airport} onAirport={(airport) => setFilter({ ...filter, airport })}
        />
      ),
    },
    {
      name: 'Started', width: 124,
      render: (i) => {
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

  return (
    <div className="home">
      <div className="home-main">
        <div className="kpi-block">
          <div className="kpis">
            <Stat label="Est. delay cost" value={cost(repTotal)} />
            <Stat label="Hidden as “late aircraft”" value={cost(t.reported.late)} />
            <Stat label="Traced to weather" value={cost(t.decoded.weather)} />
            <Stat label="Airline-controllable" value={cost(t.decoded.airline)} />
            <Stat label="Flights delayed 15+ min" value={fmt(delayed)} />
            <Stat label="Cancelled" value={fmt(cancelled)} />
          </div>
          <p className="kpi-note">{COST_NOTE}</p>
        </div>

        <Section
          className="home-table-section"
          title={singleTail ? `Tail ${singleTail}` : q.trim() ? `Flights matching “${q.trim()}”` : 'Biggest delays'}
          subtitle={singleTail ? 'Every flight this aircraft flew today, in order. Open one to trace it.' : 'Open a flight to see its plane’s day on the map. Filter from the column headers.'}
          icon={singleTail ? 'airplane' : 'th-list'}
          rightElement={
            <span className="table-meta">
              {filtersSet && <Button variant="minimal" size="small" icon="filter-remove" text="Clear filters" onClick={() => setFilter(NO_FILTER)} />}
              <span className="filter-count">{fmt(rows.length)} {rows.length === 1 ? 'flight' : 'flights'}</span>
            </span>
          }
        >
          <SectionCard padded>
            <InputGroup
              size="large"
              leftIcon="search"
              placeholder="Search a tail number or a flight number, e.g. WN 4067 or N7740A"
              value={q}
              onValueChange={(v) => { setQ(v); setSelected([]) }}
              rightElement={q ? <Button variant="minimal" icon="cross" aria-label="Clear search" onClick={() => setQ('')} /> : undefined}
              spellCheck={false}
            />
            {singleTail && rows.length > 0 && (
              <Callout className="tail-callout" icon={null} compact>
                <RippleChain day={day} chain={tailChain(day, rows[0])} selected={-1} onSelect={onOpenFlight} />
              </Callout>
            )}
          </SectionCard>
          <SectionCard padded={false} className="table-card" ref={cardRef}>
            {rows.length === 0 ? (
              <NonIdealState icon="search" title="No matching flights" description={`Nothing on ${prettyDate(day.date)} matches. Try clearing filters.`} />
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
                cellRendererDependencies={[rows, filter]}
              >
                {columns.map((c) => (
                  <Column
                    key={c.name}
                    name={c.name}
                    columnHeaderCellRenderer={() => (
                      <ColumnHeaderCell
                        name={c.name}
                        className={`${c.className ?? ''}${c.menu ? ' has-filter' : ''}${c.filtered ? ' filtered' : ''}`}
                        menuRenderer={c.menu}
                        menuIcon={c.filtered ? 'filter-keep' : 'filter'}
                        nameRenderer={(name) => (
                          <span className="th-name">{name}{c.filtered && <Icon icon="filter" size={12} className="th-filter-on" />}</span>
                        )}
                      />
                    )}
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
