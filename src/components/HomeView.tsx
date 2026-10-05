import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, Card, Classes, H2, InputGroup, NonIdealState, Section, SectionCard, Tag } from '@blueprintjs/core'
import { Cell, Column, ColumnHeaderCell, RegionCardinality, Table2, type Region } from '@blueprintjs/table'
import { CATS, delayRows, flightLabel, REPORTED, rootOf, route, sum, tailChain, topReported, type Day } from '../data'
import { CAT_META, REPORTED_META, clock, dur, fmt, pct, prettyDate } from '../theme'
import CauseCompare from './CauseCompare'
import { RippleChain } from './Panels'

interface Props {
  day: Day
  onOpenFlight: (i: number) => void
}

export default function HomeView({ day, onOpenFlight }: Props) {
  const [q, setQ] = useState('')
  const { rows, tails } = useMemo(() => delayRows(day, q), [day, q])
  const [selected, setSelected] = useState<Region[]>([])
  const f = day.flights
  const t = day.totals
  const repTotal = sum(REPORTED.map((k) => t.reported[k]))
  const delayed = useMemo(() => f.arrDelay.filter((d, i) => !f.otherDay[i] && (d ?? 0) >= 15).length, [f])
  const cancelled = sum(Object.values(t.cancelled))
  const singleTail = q.trim() && tails.length === 1 ? tails[0] : null

  const cell = (render: (i: number) => React.ReactNode, className?: string) => (r: number) => (
    <Cell className={className} interactive>{render(rows[r])}</Cell>
  )

  const columns = [
    { name: 'Flight', width: 92, render: (i: number) => <strong>{flightLabel(day, i)}</strong> },
    { name: 'Tail', width: 92, render: (i: number) => <span className="mono">{f.tail[i] || '—'}</span> },
    { name: 'Route', width: 112, render: (i: number) => route(day, i) },
    { name: 'Sched. dep (ET)', width: 120, render: (i: number) => clock(f.sdep[i]) },
    {
      name: 'Arr. delay', width: 96, className: 'num',
      render: (i: number) => f.status[i].startsWith('C') ? <Tag minimal intent="danger">Cancelled</Tag> : (f.arrDelay[i] ?? 0) >= 15 ? <strong>+{dur(f.arrDelay[i]!)}</strong> : <span className={Classes.TEXT_MUTED}>On time</span>,
    },
    {
      name: 'BTS reported', width: 148,
      render: (i: number) => {
        const r = topReported(day, i)
        if (!r) return <span className={Classes.TEXT_MUTED}>—</span>
        return <span className="dot-label"><i className={REPORTED_META[r[0]].hatch ? 'hatch' : ''} style={{ background: REPORTED_META[r[0]].hatch ? undefined : REPORTED_META[r[0]].color, ['--seg' as string]: REPORTED_META[r[0]].color }} />{REPORTED_META[r[0]].label} <span className={Classes.TEXT_MUTED}>{pct(r[1], 1)}</span></span>
      },
    },
    {
      name: 'Decoded root cause', width: 190,
      render: (i: number) => {
        const r = rootOf(day, i)
        if (!r) return <span className={Classes.TEXT_MUTED}>—</span>
        const c = CAT_META[CATS[r.cat]]
        return <span className="dot-label"><i style={{ background: c.color }} />{c.short} at <strong>{day.airports[r.airport]?.code ?? '?'}</strong> <span className={Classes.TEXT_MUTED}>{pct(r.share, 1)}</span></span>
      },
    },
    {
      name: 'Started', width: 132,
      render: (i: number) => {
        const r = rootOf(day, i)
        if (!r) return ''
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
  const baseWidth = sum(columns.map((c) => c.width))
  const extra = Math.max(0, cardWidth - baseWidth - 2)
  const widths = columns.map((c) => c.width + (c.name === 'BTS reported' || c.name === 'Decoded root cause' ? extra / 2 : 0))

  const onSelection = (regions: Region[]) => {
    setSelected(regions)
    const row = regions[0]?.rows?.[0]
    if (row != null && rows[row] != null) onOpenFlight(rows[row])
  }

  return (
    <div className="home">
      <div className="home-head">
        <p className="eyebrow">{prettyDate(day.date)} · {fmt(t.flights)} flights</p>
        <H2 className="headline">
          Airlines filed <em>{pct(t.reported.late, repTotal)}</em> of today’s delay as “late aircraft.” Traced back plane by plane,{' '}
          <em style={{ color: CAT_META.weather.color }}>{pct(t.decoded.weather, repTotal)}</em> started with weather.
        </H2>
      </div>

      <div className="home-grid">
        <div className="home-stats">
          <Stat label="Flights operated" value={fmt(t.flights - cancelled)} />
          <Stat label="Arrived 15+ min late" value={fmt(delayed)} sub={pct(delayed, t.flights)} />
          <Stat label="Cancelled" value={fmt(cancelled)} sub={pct(cancelled, t.flights)} />
          <Stat label="Delay minutes" value={fmt(repTotal)} sub={`${dur(repTotal / Math.max(1, delayed))} per delayed flight`} />
        </div>
        <Card className="home-compare" compact>
          <CauseCompare reported={REPORTED.map((k) => t.reported[k])} decoded={CATS.map((k) => t.decoded[k])} />
        </Card>
      </div>

      <Section
        className="home-table-section"
        title={singleTail ? `Tail ${singleTail}` : q.trim() ? `Flights matching “${q.trim()}”` : 'Biggest delays'}
        subtitle={singleTail ? 'Every flight this aircraft flew today, in order. Click one to trace it on the map.' : 'Click a flight to trace its delay on the map.'}
        icon={singleTail ? 'airplane' : 'th-list'}
        rightElement={<Tag minimal round>{fmt(rows.length)}{rows.length === 300 ? '+' : ''} flights</Tag>}
      >
        <SectionCard padded>
          <InputGroup
            size="large"
            leftIcon="search"
            placeholder="Search a tail number, e.g. N411WD (or a flight like DL3186)"
            value={q}
            onValueChange={(v) => { setQ(v); setSelected([]) }}
            rightElement={q ? <Button variant="minimal" icon="cross" aria-label="Clear search" onClick={() => setQ('')} /> : undefined}
            autoFocus
            spellCheck={false}
          />
          {singleTail && (
            <Callout className="tail-callout" icon={null} compact>
              <RippleChain day={day} chain={tailChain(day, rows[0])} selected={-1} roots={new Set()} onSelect={(s) => s?.type === 'flight' && onOpenFlight(s.index)} />
            </Callout>
          )}
        </SectionCard>
        <SectionCard padded={false} className="table-card" ref={cardRef}>
          {rows.length === 0 ? (
            <NonIdealState icon="search" title="No matching flights" description={`Nothing on ${prettyDate(day.date)} matches “${q}”. Tail numbers look like N411WD.`} />
          ) : (
            <Table2
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
              key={Math.round(extra)}
            >
              {columns.map((c) => (
                <Column key={c.name} name={c.name} columnHeaderCellRenderer={() => <ColumnHeaderCell name={c.name} className={c.className} />} cellRenderer={cell(c.render, c.className)} />
              ))}
            </Table2>
          )}
        </SectionCard>
      </Section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card compact className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}{sub && <span className={Classes.TEXT_MUTED}> · {sub}</span>}</span>
    </Card>
  )
}
