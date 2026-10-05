import { useMemo } from 'react'
import { AnchorButton, Callout, Card, Classes, H3, HTMLTable, Icon, Section, SectionCard, Tag } from '@blueprintjs/core'
import { CATS, decodedByCat, flightLabel, rootOf, route, sum, type Day } from '../data'
import { CAT_META, clock, dur, hourLabel, prettyDate } from '../theme'
import CauseCompare from './CauseCompare'
import CatLabel from './CatLabel'

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
        {top && CATS[top[1].c[0]] === 'untraced' && roots.length === 1 ? (
          <>
            <b>{dur(inhMin)}</b> was inherited from earlier flights. The trail stops at{' '}
            <AnchorButton variant="minimal" size="small" intent="primary" className="inline-btn" onClick={() => onSelect(top[0])}>{flightLabel(day, top[0])}</AnchorButton>{' '}
            at <b>{day.airports[top[1].c[1]]?.code ?? '?'}</b>: the delay it brought in has no cause on file.
          </>
        ) : top && (
          <>
            <b>{dur(inhMin)}</b> was inherited
            {top[1].c[4] > 1 ? <>, mostly from {top[1].c[4]} flights earlier</> : <> from the previous flight</>}:{' '}
            <b>{CAT_META[CATS[top[1].c[0]]].label.toLowerCase()}</b>{' '}
            at <b>{day.airports[top[1].c[1]]?.code ?? '?'}</b> around {clock(top[1].c[3])}, on{' '}
            <AnchorButton variant="minimal" size="small" intent="primary" className="inline-btn" onClick={() => onSelect(top[0])}>{flightLabel(day, top[0])}</AnchorButton>.
          </>
        )}
      </>
    )
  }

  const dep = f.sdep[index] + (f.depDelay[index] ?? 0)
  const arrT = f.sarr[index] + (arr ?? 0)
  const cancelled = status.startsWith('C')
  const evidence = rootCode ? weatherEvidence(day.weather[rootCode]) : null

  return (
    <div className="panel-body">
      <div>
        <p className="eyebrow">{f.tail[index] || 'No tail number'} · {prettyDate(day.date)}</p>
        <H3 className="panel-title">{flightLabel(day, index)} <span className="title-route">{route(day, index)}</span></H3>
      </div>

      <dl className="times">
        <dt>Departure</dt>
        <dd><span className={Classes.TEXT_MUTED}>{clock(f.sdep[index])}</span>{!cancelled && f.depDelay[index] != null && <> → {clock(dep)}</>}</dd>
        <dt>Arrival</dt>
        <dd><span className={Classes.TEXT_MUTED}>{clock(f.sarr[index])}</span>{!cancelled && arr != null && <> → {clock(arrT)}</>}</dd>
        <dt>Delay</dt>
        <dd>{cancelled ? <Tag minimal intent="danger">Cancelled</Tag> : arr != null && arr >= 15 ? <b className="late">+{dur(arr)}</b> : 'On time'}</dd>
      </dl>

      <Callout className="summary" icon={root ? CAT_META[CATS[root.cat]].icon : 'help'} intent={root ? 'primary' : 'none'} title={root ? `${CAT_META[CATS[root.cat]].label} at ${rootCode}` : 'No root cause recorded'}>
        <p className="sentence">{sentence}</p>
        {evidence && <p className="evidence"><Icon icon="cloud" size={12} /> {rootCode}: {evidence}</p>}
      </Callout>

      {f.causes[index] && (
        <Section compact title="Reported vs decoded" icon="comparison">
          <SectionCard><CauseCompare reported={f.causes[index]!} decoded={decodedByCat(contribs)} /></SectionCard>
        </Section>
      )}

      <Section compact title="The plane’s day" icon="airplane" subtitle={`${chain.length} flight${chain.length === 1 ? '' : 's'} · select one to trace it`}>
        <SectionCard>
          <RippleChain day={day} chain={chain} selected={index} roots={new Set(roots.map(([r]) => r))} onSelect={onSelect} />
        </SectionCard>
      </Section>

      {contribs.length > 0 && (
        <Section compact collapsible collapseProps={{ defaultIsOpen: false }} title="Minute-by-minute breakdown" icon="th-list">
          <SectionCard padded={false}>
            <HTMLTable compact interactive className="contrib-table">
              <thead>
                <tr><th>Cause</th><th>At</th><th>When</th><th>Started on</th><th className="num">Min</th></tr>
              </thead>
              <tbody>
                {contribs.slice(0, 10).map((c, k) => {
                  const cat = CAT_META[CATS[c[0]]]
                  return (
                    <tr key={k} onClick={() => c[2] >= 0 && onSelect(c[2])}>
                      <td><CatLabel icon={cat.icon}>{cat.short}</CatLabel></td>
                      <td><strong>{day.airports[c[1]]?.code ?? '?'}</strong></td>
                      <td className="nowrap">{clock(c[3])}</td>
                      <td className="nowrap">{c[4] === 0 ? 'This flight' : <>{c[2] >= 0 ? flightLabel(day, c[2]) : '?'} <span className={Classes.TEXT_MUTED}>({c[4]} back)</span></>}</td>
                      <td className="num">{c[5]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </HTMLTable>
          </SectionCard>
        </Section>
      )}
    </div>
  )
}

/** "Thunderstorms 1p–9p ET" style summary of the weather on record at an airport, or null. */
function weatherEvidence(wx: ([number, number, number, string] | null)[] | undefined): string | null {
  if (!wx) return null
  const ts = wx.map((x, h) => (x?.[0] ? h : -1)).filter((h) => h >= 0)
  const ifr = wx.map((x, h) => (x?.[1] ? h : -1)).filter((h) => h >= 0)
  const range = (hs: number[]) => `${hourLabel(hs[0])}–${hourLabel(hs[hs.length - 1] + 1)} ET`
  if (ts.length) return `thunderstorms on record ${range(ts)}`
  if (ifr.length) return `low ceilings or visibility on record ${range(ifr)}`
  return 'no adverse weather on record'
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
                {sum(inh) > 0 && <span className="inherited" style={{ width: `${(100 * sum(inh)) / max}%` }} title={`${dur(sum(inh))} inherited`} />}
                {sum(by) > 0 && <span className="own" style={{ width: `${(100 * sum(by)) / max}%` }} title={`${dur(sum(by))} started on this flight`} />}
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
