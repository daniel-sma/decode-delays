import { useMemo, useState } from 'react'
import { AnchorButton, Card, Classes, H3, HTMLTable, Section, SectionCard, Tag } from '@blueprintjs/core'
import { CATS, decodedByCat, flightLabel, rootOf, route, sum, type Day } from '../data'
import { CAT_META, clock, dur, hourLabel } from '../theme'
import CauseCompare from './CauseCompare'

const CANCEL = { A: 'Carrier', B: 'Weather', C: 'NAS', D: 'Security' } as Record<string, string>

// ------------------------------------------------------------------ flight sidebar

export function FlightPanel({ day, index, chain, onSelect }: {
  day: Day; index: number; chain: number[]; onSelect: (i: number) => void
}) {
  const f = day.flights
  const contribs = f.decoded[index]
  const arr = f.arrDelay[index]
  const status = f.status[index]
  const own = contribs.filter((c) => c[4] === 0)
  const inherited = contribs.filter((c) => c[4] > 0)
  const ownMin = sum(own.map((c) => c[5]))
  const inhMin = sum(inherited.map((c) => c[5]))
  const root = rootOf(day, index)
  const rootCode = root ? day.airports[root.airport]?.code : undefined

  // Inherited minutes grouped by the flight where they started.
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

  let sentence: React.ReactNode
  if (status.startsWith('C')) {
    sentence = <>Cancelled. The airline reported the cause as <b>{CANCEL[status.slice(1)] ?? 'unknown'}</b>.</>
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
            <AnchorButton variant="minimal" size="small" intent="primary" className="inline-btn" onClick={() => onSelect(top[0])}>{flightLabel(day, top[0])}</AnchorButton>.
          </>
        )}
      </>
    )
  }

  return (
    <div className="panel-body">
      <div>
        <p className="eyebrow">{f.tail[index] || 'No tail number'} · {chain.length} flight{chain.length === 1 ? '' : 's'} today</p>
        <H3 className="panel-title">{flightLabel(day, index)}</H3>
        <p className={Classes.TEXT_MUTED}>{route(day, index)} · departs {clock(f.sdep[index])} ET</p>
      </div>

      <div className="stats">
        <Stat label="Arrival delay" value={status.startsWith('C') ? 'Cancelled' : arr != null && arr >= 15 ? dur(arr) : 'On time'} />
        <Stat label="Root cause" value={root ? CAT_META[CATS[root.cat]].short : '—'} color={root ? CAT_META[CATS[root.cat]].color : undefined} />
        <Stat label="Started at" value={rootCode ?? '—'} />
      </div>

      <Card compact className="sentence-card"><p className="sentence">{sentence}</p></Card>

      {f.causes[index] && (
        <Section compact title="Reported vs decoded" icon="comparison">
          <SectionCard><CauseCompare reported={f.causes[index]!} decoded={decodedByCat(contribs)} /></SectionCard>
        </Section>
      )}

      {contribs.length > 0 && (
        <Section compact title="Where the minutes came from" icon="flow-linear" subtitle="Each chunk of this flight’s delay, traced to its origin">
          <SectionCard padded={false}>
            <HTMLTable compact interactive className="contrib-table">
              <thead>
                <tr><th>Cause</th><th>At</th><th>When</th><th>Started on</th><th className="num">Min</th></tr>
              </thead>
              <tbody>
                {contribs.slice(0, 8).map((c, k) => {
                  const cat = CAT_META[CATS[c[0]]]
                  const rootFlight = c[2]
                  return (
                    <tr key={k} onClick={() => rootFlight >= 0 && onSelect(rootFlight)}>
                      <td><span className="dot-label"><i style={{ background: cat.color }} />{cat.short}</span></td>
                      <td><strong>{day.airports[c[1]]?.code ?? '?'}</strong></td>
                      <td className="nowrap">{clock(c[3])}</td>
                      <td className="nowrap">{c[4] === 0 ? 'This flight' : <>{rootFlight >= 0 ? flightLabel(day, rootFlight) : '?'} <span className={Classes.TEXT_MUTED}>({c[4]} back)</span></>}</td>
                      <td className="num">{c[5]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </HTMLTable>
          </SectionCard>
        </Section>
      )}

      {rootCode && day.weather[rootCode] && <WeatherStrip code={rootCode} wx={day.weather[rootCode]} />}

      <Section compact title="The plane’s day" icon="airplane" subtitle="Hatched = delay brought in from the leg before">
        <SectionCard>
          <RippleChain day={day} chain={chain} selected={index} roots={new Set(roots.map(([r]) => r))} onSelect={onSelect} />
        </SectionCard>
      </Section>
    </div>
  )
}

function WeatherStrip({ code, wx }: { code: string; wx: ([number, number, number, string] | null)[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const h = hover != null ? wx[hover] : null
  const stormHours = wx.filter((x) => x?.[0]).length
  return (
    <Section compact title={`Weather at ${code}`} icon="cloud" subtitle={stormHours ? `${stormHours} hours with thunderstorms on record` : 'Hourly ASOS / METAR, Eastern time'}>
      <SectionCard>
        <div className="wx" onMouseLeave={() => setHover(null)}>
          {wx.map((x, i) => (
            <span key={i} className={`wx-cell${x?.[0] ? ' ts' : x?.[1] ? ' ifr' : ''}${x == null ? ' none' : ''}`} onMouseEnter={() => setHover(i)} />
          ))}
        </div>
        <div className="wx-legend">
          <span><i className="wx-cell ts" /> Thunderstorm</span>
          <span><i className="wx-cell ifr" /> IFR (vis &lt; 3 mi or ceiling &lt; 1,000 ft)</span>
        </div>
        <p className="metar">{h ? <><b>{hourLabel(hover!)} ET</b> {h[3]}</> : hover != null ? 'No observation' : 'Hover an hour to read the METAR.'}</p>
      </SectionCard>
    </Section>
  )
}

export function RippleChain({ day, chain, selected, roots, onSelect }: {
  day: Day; chain: number[]; selected: number; roots: Set<number>; onSelect: (i: number) => void
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
            <button onClick={() => onSelect(i)}>
              <span className="chain-time">{clock(f.sdep[i])}</span>
              <span className="chain-route">
                {route(day, i)} <small>{flightLabel(day, i)}</small>
                {roots.has(i) && <Tag minimal intent="primary" className="badge">delay started here</Tag>}
              </span>
              <span className="chain-delay">{cancelled ? <Tag minimal intent="danger">Cancelled</Tag> : arr == null ? '—' : arr >= 15 ? `+${dur(arr)}` : 'On time'}</span>
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

export function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card compact className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={color ? { color } : undefined}>{value}</span>
      {sub && <span className={`stat-sub ${Classes.TEXT_MUTED}`}>{sub}</span>}
    </Card>
  )
}

function topCat(cs: { 0: number; 5: number }[]) {
  const by = CATS.map(() => 0)
  for (const c of cs) by[c[0]] += c[5]
  return CAT_META[CATS[by.indexOf(Math.max(...by))]].label.toLowerCase()
}
