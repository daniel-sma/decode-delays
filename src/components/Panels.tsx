import { useMemo, useState } from 'react'
import {
  CATS, REPORTED, decodedByCat, decodedForArrivals, flightLabel, reportedForArrivals, route, sum, tailChain,
  type Arc, type Day, type Summary,
} from '../data'
import { CAT_META, clock, dur, fmt, hourLabel, pct, prettyDate } from '../theme'
import CauseCompare from './CauseCompare'
import type { Selection } from '../App'

const CANCEL = { A: 'Carrier', B: 'Weather', C: 'NAS', D: 'Security' } as Record<string, string>

// ------------------------------------------------------------------ overview

export function OverviewPanel({ day, summary, onDay, onSelect }: {
  day: Day; summary: Summary; onDay: (d: string) => void; onSelect: (s: Selection) => void
}) {
  const t = day.totals
  const rep = REPORTED.map((k) => t.reported[k])
  const dec = CATS.map((k) => t.decoded[k])
  const total = sum(rep)
  const cancelled = sum(Object.values(t.cancelled))

  const exporters = useMemo(() =>
    day.airports
      .map((a, i) => ({ i, a, exported: sum(a.exported), dom: dominant(a.origin.map(sum)) }))
      .filter((x) => x.exported > 0)
      .sort((x, y) => y.exported - x.exported)
      .slice(0, 6), [day])
  const maxExp = exporters[0]?.exported ?? 1

  return (
    <div className="panel-body">
      <p className="eyebrow">{prettyDate(day.date)} · {fmt(t.flights)} flights · {fmt(cancelled)} cancelled</p>
      <h2 className="headline">
        Airlines filed <em>{pct(t.reported.late, total)}</em> of today’s delay as “late aircraft.” Traced back plane by plane,{' '}
        <em style={{ color: CAT_META.weather.color }}>{pct(t.decoded.weather, total)}</em> started with weather.
      </h2>
      <p className="lede">
        “Late aircraft” only means the plane showed up late from its last flight. We follow each tail number
        upstream to the flight where the delay actually began, and check the weather at that airport and hour.
      </p>

      <CauseCompare reported={rep} decoded={dec} />

      <section>
        <h3>Where delay was exported from</h3>
        <p className="hint">Minutes that started at this airport but were felt somewhere else.</p>
        <ul className="rank">
          {exporters.map(({ i, a, exported, dom }) => (
            <li key={a.code}>
              <button onClick={() => onSelect({ type: 'airport', index: i })}>
                <span className="rank-code">{a.code}</span>
                <span className="rank-bar"><span style={{ width: `${(100 * exported) / maxExp}%`, background: CAT_META[CATS[dom]].color }} /></span>
                <span className="rank-val">{dur(exported)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <MonthStrip summary={summary} current={day.date} onDay={onDay} />
      <Method summary={summary} />
    </div>
  )
}

function MonthStrip({ summary, current, onDay }: { summary: Summary; current: string; onDay: (d: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(...summary.days.map((d) => d.delayed + d.cancelled))
  const h = summary.days.find((d) => d.date === hover)
  return (
    <section>
      <h3>{new Date(summary.month + '-01T00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
      <p className="hint">{h ? `${prettyDate(h.date)}: ${fmt(h.delayed)} delayed, ${fmt(h.cancelled)} cancelled` : 'Delayed + cancelled flights per day. Highlighted days are explorable.'}</p>
      <div className="month" onMouseLeave={() => setHover(null)}>
        {summary.days.map((d) => {
          const ok = summary.availableDays.includes(d.date)
          return (
            <button
              key={d.date}
              className={`month-day${d.date === current ? ' current' : ''}${ok ? ' ok' : ''}`}
              disabled={!ok}
              onClick={() => ok && onDay(d.date)}
              onMouseEnter={() => setHover(d.date)}
              aria-label={`${prettyDate(d.date)}: ${d.delayed} delayed`}
            >
              <span style={{ height: `${(100 * (d.delayed + d.cancelled)) / max}%` }} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Method({ summary }: { summary: Summary }) {
  const tr = summary.trace
  return (
    <details className="method">
      <summary>How the decoding works</summary>
      <ol>
        <li>BTS requires airlines to split every arrival delay of 15+ minutes into five causes: carrier, weather, NAS (air traffic), security and late aircraft.</li>
        <li>Each flight is linked to the previous flight flown by the same tail number, if it left from where that one landed within 16 hours.</li>
        <li>A flight’s late-aircraft minutes are split across the previous flight’s own decoded causes, in proportion, recursively, so delay can be traced several legs back.</li>
        <li>NAS and weather minutes are placed at whichever end of the flight had thunderstorms, IFR conditions or gusts of 35 kt or more (ASOS/METAR within an hour). NAS with weather on record counts as weather; otherwise it stays as airspace and volume.</li>
        <li>Any minutes that can’t be traced stay grey. Nothing is invented.</li>
      </ol>
      <p className="hint">
        This month: {pct(tr.lateTraced, tr.lateMinutes)} of {fmt(tr.lateMinutes)} late-aircraft minutes traced to a root cause.
        Source: {summary.source}. Times in Eastern.
      </p>
    </details>
  )
}

// ------------------------------------------------------------------ airport

export function AirportPanel({ day, index, onSelect }: { day: Day; index: number; onSelect: (s: Selection) => void }) {
  const a = day.airports[index]
  const deps = sum(a.deps)
  const delayed = sum(a.delayedDeps)
  const cancelled = sum(a.cancelled)
  const originTotal = sum(a.origin.map(sum))
  const exported = sum(a.exported)
  const wx = day.weather[a.code]

  const destinations = useMemo(() => {
    const m = new Map<number, number>()
    for (const arc of day.arcs) if (arc[0] === index) m.set(arc[1], (m.get(arc[1]) ?? 0) + arc[4])
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6)
  }, [day, index])

  const worst = useMemo(() => {
    const f = day.flights
    const xs: number[] = []
    for (let i = 0; i < f.o.length; i++) if (!f.otherDay[i] && (f.o[i] === index || f.d[i] === index)) xs.push(i)
    return xs.sort((x, y) => (f.arrDelay[y] ?? -1) - (f.arrDelay[x] ?? -1)).slice(0, 5)
  }, [day, index])

  return (
    <div className="panel-body">
      <p className="eyebrow">{a.city}</p>
      <h2 className="title">{a.code} <span>{a.name}</span></h2>
      <div className="stats">
        <Stat label="Departures" value={fmt(deps)} />
        <Stat label="Left 15+ min late" value={pct(delayed, deps)} />
        <Stat label="Cancelled" value={fmt(cancelled)} />
      </div>

      <section>
        <h3>Delay landing at {a.code}</h3>
        <CauseCompare reported={reportedForArrivals(day, index)} decoded={decodedForArrivals(day, index)} />
      </section>

      <section>
        <h3>Delay that started at {a.code}</h3>
        <p className="hint">{dur(originTotal)} total, {pct(exported, originTotal)} of it felt at other airports.</p>
        <HourBars rows={a.origin} />
        {destinations.length > 0 && (
          <ul className="rank compact">
            {destinations.map(([d, m]) => (
              <li key={d}>
                <button onClick={() => onSelect({ type: 'airport', index: d })}>
                  <span className="rank-code">→ {day.airports[d].code}</span>
                  <span className="rank-bar"><span style={{ width: `${(100 * m) / destinations[0][1]}%` }} /></span>
                  <span className="rank-val">{dur(m)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {wx && <WeatherStrip wx={wx} />}

      <section>
        <h3>Most-delayed flights</h3>
        <FlightList day={day} ids={worst} onSelect={onSelect} />
      </section>
    </div>
  )
}

function HourBars({ rows }: { rows: number[][] }) {
  const hours = rows[0].length
  const totals = Array.from({ length: hours }, (_, h) => sum(rows.map((r) => r[h])))
  const max = Math.max(1, ...totals)
  return (
    <svg className="hourbars" viewBox={`0 0 ${hours * 10} 44`} preserveAspectRatio="none" width="100%" height="44">
      {totals.map((_, h) => {
        let y = 44
        return rows.map((r, c) => {
          if (!r[h]) return null
          const hh = (r[h] / max) * 42
          y -= hh
          return <rect key={`${h}-${c}`} x={h * 10 + 1} y={y} width={8} height={Math.max(0, hh - 0.5)} fill={CAT_META[CATS[c]].color}><title>{`${hourLabel(h)}: ${dur(r[h])} ${CAT_META[CATS[c]].short}`}</title></rect>
        })
      })}
    </svg>
  )
}

function WeatherStrip({ wx }: { wx: ([number, number, number, string] | null)[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const h = hover != null ? wx[hover] : null
  return (
    <section>
      <h3>Weather on record</h3>
      <div className="wx" onMouseLeave={() => setHover(null)}>
        {wx.map((x, i) => (
          <span
            key={i}
            className={`wx-cell${x?.[0] ? ' ts' : x?.[1] ? ' ifr' : ''}${x == null ? ' none' : ''}`}
            onMouseEnter={() => setHover(i)}
            title={x?.[3] ?? 'No observation'}
          />
        ))}
      </div>
      <div className="wx-legend">
        <span><i className="wx-cell ts" /> Thunderstorm</span>
        <span><i className="wx-cell ifr" /> IFR (vis &lt; 3 mi or ceiling &lt; 1,000 ft)</span>
      </div>
      <p className="metar">{h ? <><b>{hourLabel(hover!)} ET</b> {h[3]}</> : hover != null ? 'No observation' : 'Hover an hour to read the METAR.'}</p>
    </section>
  )
}

// ------------------------------------------------------------------ flight

export function FlightPanel({ day, index, onSelect }: { day: Day; index: number; onSelect: (s: Selection) => void }) {
  const f = day.flights
  const chain = useMemo(() => tailChain(day, index), [day, index])
  const contribs = f.decoded[index]
  const arr = f.arrDelay[index]
  const status = f.status[index]
  const own = contribs.filter((c) => c[4] === 0)
  const inherited = contribs.filter((c) => c[4] > 0)
  const ownMin = sum(own.map((c) => c[5]))
  const inhMin = sum(inherited.map((c) => c[5]))

  // Group inherited minutes by the flight where they started.
  const roots = useMemo(() => {
    const m = new Map<number, { min: number; c: (typeof contribs)[number] }>()
    for (const c of inherited) {
      const cur = m.get(c[2])
      if (!cur) m.set(c[2], { min: c[5], c })
      else {
        cur.min += c[5]
        if (c[5] > cur.c[5]) cur.c = c
      }
    }
    return [...m.entries()].sort((a, b) => b[1].min - a[1].min)
  }, [inherited])
  const rootSet = new Set(roots.map(([r]) => r))

  let sentence: React.ReactNode
  if (status.startsWith('C')) {
    const code = status.slice(1)
    sentence = <>Cancelled. Airline reported the cause as <b>{CANCEL[code] ?? 'unknown'}</b>.</>
  } else if (status === 'D') {
    sentence = <>Diverted to another airport.</>
  } else if (arr == null || arr < 15) {
    sentence = <>Arrived {arr == null ? '' : arr <= 0 ? `${-arr} min early` : `${arr} min late`}, under BTS’s 15-minute threshold, so no cause is recorded.</>
  } else {
    const top = roots[0]
    sentence = (
      <>
        Arrived <b>{dur(arr)}</b> late.{' '}
        {ownMin > 0 && <>{dur(ownMin)} started on this flight ({topCat(own)}). </>}
        {top && (
          <>
            <b>{dur(inhMin)}</b> was inherited
            {top[1].c[4] > 1 ? <>, mostly from {top[1].c[4]} flights earlier</> : <> from the previous flight</>}:{' '}
            <span style={{ color: CAT_META[CATS[top[1].c[0]]].color }}>{CAT_META[CATS[top[1].c[0]]].label.toLowerCase()}</span>{' '}
            at <b>{day.airports[top[1].c[1]]?.code ?? '?'}</b> around {clock(top[1].c[3])}, on{' '}
            <button className="inline" onClick={() => onSelect({ type: 'flight', index: top[0] })}>{flightLabel(day, top[0])}</button>.
          </>
        )}
      </>
    )
  }

  return (
    <div className="panel-body">
      <p className="eyebrow">{f.tail[index] || 'No tail number'} · {clock(f.sdep[index])} departure</p>
      <h2 className="title">{flightLabel(day, index)} <span>{route(day, index)}</span></h2>
      <p className="sentence">{sentence}</p>

      {f.causes[index] && (
        <CauseCompare reported={f.causes[index]!} decoded={decodedByCat(contribs)} />
      )}

      <section>
        <h3>The plane’s day</h3>
        <p className="hint">Every flight this aircraft flew. Hatched = delay it brought in from the leg before.</p>
        <RippleChain day={day} chain={chain} selected={index} roots={rootSet} onSelect={onSelect} />
      </section>
    </div>
  )
}

function RippleChain({ day, chain, selected, roots, onSelect }: {
  day: Day; chain: number[]; selected: number; roots: Set<number>; onSelect: (s: Selection) => void
}) {
  const f = day.flights
  const max = Math.max(15, ...chain.map((i) => f.arrDelay[i] ?? 0))
  return (
    <ol className="chain">
      {chain.map((i, n) => {
        const arr = f.arrDelay[i]
        const by = decodedByCat(f.decoded[i].filter((c) => c[4] === 0))
        const inh = decodedByCat(f.decoded[i].filter((c) => c[4] > 0))
        const cancelled = f.status[i].startsWith('C')
        const linked = n > 0 && f.prev[i] === chain[n - 1]
        return (
          <li key={i} className={`${i === selected ? 'sel' : ''}${linked ? '' : ' break'}`}>
            <button onClick={() => onSelect({ type: 'flight', index: i })}>
              <span className="chain-time">{clock(f.sdep[i])}</span>
              <span className="chain-route">
                {route(day, i)} <small>{flightLabel(day, i)}</small>
                {roots.has(i) && <em className="badge">delay started here</em>}
              </span>
              <span className="chain-delay">{cancelled ? 'Cancelled' : arr == null ? '—' : arr >= 15 ? `+${dur(arr)}` : 'On time'}</span>
              <span className="chain-bar">
                {by.map((v, c) => v > 0 && <span key={`o${c}`} style={{ width: `${(100 * v) / max}%`, background: CAT_META[CATS[c]].color }} />)}
                {inh.map((v, c) => v > 0 && <span key={`i${c}`} className="hatch" style={{ width: `${(100 * v) / max}%`, ['--seg' as string]: CAT_META[CATS[c]].color }} />)}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ------------------------------------------------------------------ arc

export function ArcPanel({ day, arc, onSelect }: { day: Day; arc: Arc; onSelect: (s: Selection) => void }) {
  const [s, t, h, cat, minutes, ids] = arc
  const c = CAT_META[CATS[cat]]
  return (
    <div className="panel-body">
      <p className="eyebrow">Delay carried by aircraft · landing {hourLabel(h)}–{hourLabel(h + 1)} ET</p>
      <h2 className="title">{day.airports[s].code} → {day.airports[t].code}</h2>
      <p className="sentence">
        <b>{dur(minutes)}</b> of <span style={{ color: c.color }}>{c.label.toLowerCase()}</span> delay that began at{' '}
        <b>{day.airports[s].code}</b> reached <b>{day.airports[t].code}</b> on {ids.length} flight{ids.length === 1 ? '' : 's'}.
      </p>
      <FlightList day={day} ids={ids} onSelect={onSelect} />
    </div>
  )
}

// ------------------------------------------------------------------ shared

export function FlightList({ day, ids, onSelect }: { day: Day; ids: number[]; onSelect: (s: Selection) => void }) {
  const f = day.flights
  return (
    <ul className="flights">
      {ids.map((i) => (
        <li key={i}>
          <button onClick={() => onSelect({ type: 'flight', index: i })}>
            <span className="fl-label">{flightLabel(day, i)}</span>
            <span className="fl-route">{route(day, i)}</span>
            <span className="fl-delay">{f.status[i].startsWith('C') ? 'Cancelled' : f.arrDelay[i] != null ? `+${dur(Math.max(0, f.arrDelay[i]!))}` : '—'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function dominant(xs: number[]) {
  return xs.indexOf(Math.max(...xs))
}

function topCat(cs: { 0: number; 5: number }[]) {
  const by = CATS.map(() => 0)
  for (const c of cs) by[c[0]] += c[5]
  return CAT_META[CATS[dominant(by)]].label.toLowerCase()
}
