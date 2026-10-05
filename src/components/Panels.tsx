import { useMemo } from 'react'
import { Button, Card, Classes, Icon, Tag, type Intent } from '@blueprintjs/core'
import type { IconName } from '@blueprintjs/icons'
import { CATS, REPORTED, flightLabel, route, sum, type Day } from '../data'
import { CAT_META, REPORTED_META, dur, hourLabel, pct } from '../theme'
import { actualArr, actualDep, clock24, dayOffset } from './Scrubber'

const CANCEL = { A: 'carrier', B: 'weather', C: 'NAS', D: 'security' } as Record<string, string>

/** Status tag for a flight, Blueprint intents: on time, late, very late, cancelled. */
export function statusTag(day: Day, i: number, minimal = true) {
  const f = day.flights
  if (f.status[i].startsWith('C')) return <Tag minimal={minimal} intent="danger" className="status-tag">CANCELLED</Tag>
  if (f.status[i] === 'D') return <Tag minimal={minimal} intent="danger" className="status-tag">DIVERTED</Tag>
  const a = f.arrDelay[i]
  if (a == null || a < 15) return <Tag minimal={minimal} intent="success" className="status-tag">ON TIME</Tag>
  const intent: Intent = a >= 180 ? 'danger' : 'warning'
  return <Tag minimal={minimal} intent={intent} className="status-tag">+{dur(a)}</Tag>
}

const t24 = (m: number) => (
  <span className="t24">{clock24(m)}{dayOffset(m) && <sup>{dayOffset(m)}</sup>}</span>
)

// ------------------------------------------------------------------ flight sidebar

export function FlightPanel({ day, index, chain, onSelect, onClose }: {
  day: Day; index: number; chain: number[]; onSelect: (i: number) => void; onClose: () => void
}) {
  const f = day.flights
  const o = day.airports[f.o[index]], d = day.airports[f.d[index]]
  const cancelled = f.status[index].startsWith('C')
  const dep = actualDep(day, index), arr = actualArr(day, index)

  // Root causes grouped by (cause, airport), biggest first.
  const causes = useMemo(() => {
    const m = new Map<string, { cat: number; ap: number; min: number; hops: number; root: number }>()
    for (const [cat, ap, root, , hops, min] of f.decoded[index]) {
      const k = `${cat}:${ap}`
      const cur = m.get(k)
      if (cur) { cur.min += min; if (hops > cur.hops) { cur.hops = hops; cur.root = root } }
      else m.set(k, { cat, ap, min, hops, root })
    }
    return [...m.values()].sort((a, b) => b.min - a.min)
  }, [f, index])
  const total = sum(causes.map((c) => c.min))
  const reported = f.causes[index]

  const events = useMemo(() => buildEvents(day, index), [day, index])

  return (
    <div className="side">
      <div className="side-head">
        <Icon icon="airplane" size={16} className="side-head-icon" />
        <div className="side-head-text">
          <strong>{flightLabel(day, index)}</strong>
          <span>{f.tail[index] || 'No tail'} · {o.code} → {d.code}</span>
        </div>
        {statusTag(day, index, false)}
        <Button variant="minimal" size="small" icon="cross" aria-label="Back to biggest delays" onClick={onClose} />
      </div>

      <SideSection title="Route">
        <div className="field">
          <Icon icon="map-marker" size={14} />
          <span className="field-main"><b>{o.code}</b> <span className={Classes.TEXT_MUTED}>{o.city}</span></span>
          <span className="field-time">{t24(f.sdep[index])}{!cancelled && f.depDelay[index] != null && <> → {t24(dep)}</>}</span>
        </div>
        <div className="field">
          <Icon icon="flag" size={14} />
          <span className="field-main"><b>{d.code}</b> <span className={Classes.TEXT_MUTED}>{d.city}</span></span>
          <span className="field-time">{t24(f.sarr[index])}{!cancelled && f.arrDelay[index] != null && <> → {t24(arr)}</>}</span>
        </div>
      </SideSection>

      <SideSection title="Root cause" right={total ? dur(total) : undefined}>
        {causes.length === 0 ? (
          <p className="side-empty">{cancelled ? `Cancelled; airline cited ${CANCEL[f.status[index].slice(1)] ?? 'no cause'}.` : 'Under 15 minutes late, so no cause is recorded.'}</p>
        ) : (
          <ul className="rows">
            {causes.slice(0, 5).map((c, k) => {
              const meta = CAT_META[CATS[c.cat]]
              return (
                <li key={k}>
                  <button className="row" onClick={() => c.root >= 0 && onSelect(c.root)} disabled={c.root < 0 || c.root === index}>
                    <Icon icon={meta.icon} size={14} />
                    <span className="row-main">
                      <b>{meta.short} · {day.airports[c.ap]?.code ?? '?'}</b>
                      <span>{c.hops === 0 ? 'On this flight' : `${c.hops} flight${c.hops > 1 ? 's' : ''} back · ${flightLabel(day, c.root)}`}</span>
                    </span>
                    <span className="row-num">{dur(c.min)}</span>
                    <Tag minimal className="row-tag">{pct(c.min, total)}</Tag>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {reported && (
          <p className="side-note">
            Filed with BTS as {REPORTED.map((k, i) => [k, reported[i]] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `${REPORTED_META[k].label} ${pct(v, sum(reported))}`).join(' · ')}
          </p>
        )}
      </SideSection>

      <SideSection title={`Aircraft ${f.tail[index] || ''}`} right={`${chain.length} flights`}>
        <RippleChain day={day} chain={chain} selected={index} onSelect={onSelect} />
      </SideSection>

      <SideSection title="Event log">
        <ol className="events">
          {events.map((e, k) => (
            <li key={k} className={e.intent ? `ev-${e.intent}` : ''}>
              <Icon icon={e.icon} size={14} />
              <span className="ev-text">{e.text}</span>
              <span className="ev-time">{e.t != null ? t24(e.t) : ''}</span>
            </li>
          ))}
        </ol>
      </SideSection>
    </div>
  )
}

function SideSection({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="side-section">
      <header><span>{title}</span>{right && <span className="side-right">{right}</span>}</header>
      <div className="side-body">{children}</div>
    </section>
  )
}

interface Ev { t: number | null; icon: IconName; text: React.ReactNode; intent?: 'warning' | 'danger' | 'success' }

/** The selected flight's story as a log: inbound aircraft, weather on record, departure, arrival. */
function buildEvents(day: Day, i: number): Ev[] {
  const f = day.flights
  const o = day.airports[f.o[i]].code, d = day.airports[f.d[i]].code
  const out: Ev[] = []
  const p = f.prev[i]
  if (p != null) {
    const late = f.arrDelay[p] ?? 0
    out.push({
      t: actualArr(day, p), icon: 'history', intent: late >= 15 ? 'warning' : undefined,
      text: <>Inbound {flightLabel(day, p)} from {day.airports[f.o[p]].code} {late >= 15 ? <>landed <b>+{dur(late)}</b> late</> : 'landed on time'}</>,
    })
  }
  out.push({ t: f.sdep[i], icon: 'time', text: <>Scheduled to depart {o}</> })
  for (const [code, end] of [[o, 'origin'], [d, 'destination']] as const) {
    const ts = day.weather[code]?.map((x, h) => (x?.[0] ? h : -1)).filter((h) => h >= 0) ?? []
    if (ts.length) out.push({ t: ts[0] * 60, icon: 'cloud', intent: 'warning', text: <>Thunderstorms at {code} ({end}), {hourLabel(ts[0])}–{hourLabel(ts[ts.length - 1] + 1)} ET</> })
  }
  if (f.status[i].startsWith('C')) {
    out.push({ t: f.sdep[i], icon: 'cross', intent: 'danger', text: <>Cancelled: airline cited {CANCEL[f.status[i].slice(1)] ?? 'no cause'}</> })
  } else {
    const dd = f.depDelay[i] ?? 0, ad = f.arrDelay[i] ?? 0
    out.push({ t: actualDep(day, i), icon: 'arrow-right', intent: dd >= 15 ? 'warning' : undefined, text: <>Departed {o}{dd >= 15 && <> <b>+{dur(dd)}</b></>}</> })
    out.push({ t: actualArr(day, i), icon: 'tick-circle', intent: ad >= 15 ? 'warning' : 'success', text: <>Arrived {d}{ad >= 15 ? <> <b>+{dur(ad)}</b> late</> : ' on time'}</> })
  }
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
}

// ------------------------------------------------------------------ shared

/** One aircraft's flights as selectable rows with a status tag each. */
export function RippleChain({ day, chain, selected, onSelect }: {
  day: Day; chain: number[]; selected: number; roots?: Set<number>; onSelect: (i: number) => void
}) {
  const f = day.flights
  return (
    <ul className="rows">
      {chain.map((i) => (
        <li key={i}>
          <button className={`row${i === selected ? ' selected' : ''}`} onClick={() => onSelect(i)}>
            <Icon icon="airplane" size={14} />
            <span className="row-main">
              <b>{flightLabel(day, i)}</b>
              <span>{route(day, i)} · {clock24(f.sdep[i])}{dayOffset(f.sdep[i]) && <sup>{dayOffset(f.sdep[i])}</sup>}</span>
            </span>
            {statusTag(day, i)}
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card compact className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </Card>
  )
}
