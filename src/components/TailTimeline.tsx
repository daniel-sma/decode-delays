import { Card, Classes } from '@blueprintjs/core'
import { CATS, decodedByCat, flightLabel, route, type Day } from '../data'
import { CAT_META, dur, hourLabel } from '../theme'

/**
 * Gantt of one aircraft's day: the scheduled block of each leg as a ghost bar, the actual block
 * on top, and the late portion coloured by root cause (hatched where it was inherited).
 */
export default function TailTimeline({ day, chain, selected, onSelect }: {
  day: Day; chain: number[]; selected: number; onSelect: (i: number) => void
}) {
  const f = day.flights
  const times = chain.flatMap((i) => [f.sdep[i], f.sarr[i] + Math.max(0, f.arrDelay[i] ?? 0)])
  const t0 = Math.floor(Math.min(...times) / 60) * 60
  const t1 = Math.ceil(Math.max(...times) / 60) * 60 + 30
  const span = Math.max(60, t1 - t0)
  const x = (t: number) => `${((t - t0) / span) * 100}%`
  const w = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`
  const step = span > 14 * 60 ? 180 : 120
  const ticks: number[] = []
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t)

  return (
    <Card compact className="tail-timeline">
      <div className="tt-grid">
        <div className="tt-labels">
          {chain.map((i) => (
            <button key={i} className={i === selected ? 'sel' : ''} onClick={() => onSelect(i)}>
              <strong>{route(day, i)}</strong> <span className={Classes.TEXT_MUTED}>{flightLabel(day, i)}</span>
            </button>
          ))}
        </div>
        <div className="tt-track">
          {ticks.map((t) => (
            <span key={t} className="tt-tick" style={{ left: x(t) }}><em>{hourLabel(Math.floor(t / 60))}</em></span>
          ))}
          {chain.map((i) => {
            const cancelled = f.status[i].startsWith('C')
            const dep = f.sdep[i] + Math.max(0, f.depDelay[i] ?? 0)
            const arrLate = Math.max(0, f.arrDelay[i] ?? 0)
            const arr = f.sarr[i] + arrLate
            const own = decodedByCat(f.decoded[i].filter((c) => c[4] === 0))
            const inh = decodedByCat(f.decoded[i].filter((c) => c[4] > 0))
            const coded = own.reduce((a, b) => a + b, 0) + inh.reduce((a, b) => a + b, 0)
            const lateStart = Math.max(dep, f.sarr[i])
            return (
              <button key={i} className={`tt-row${i === selected ? ' sel' : ''}`} onClick={() => onSelect(i)} aria-label={`${flightLabel(day, i)} ${route(day, i)}`}>
                <span className="tt-sched" style={{ left: x(f.sdep[i]), width: w(f.sdep[i], f.sarr[i]) }} />
                {cancelled ? (
                  <span className="tt-cancel" style={{ left: x(f.sdep[i]) }}>Cancelled</span>
                ) : (
                  <>
                    <span className="tt-actual" style={{ left: x(dep), width: w(dep, Math.min(arr, Math.max(dep, f.sarr[i]))) }} />
                    {arrLate >= 15 && coded > 0 && (
                      <span className="tt-late" style={{ left: x(lateStart), width: w(lateStart, arr) }}>
                        {CATS.map((_, c) => [
                          inh[c] > 0 && <i key={`i${c}`} className="hatch" style={{ flexGrow: inh[c], ['--seg' as string]: CAT_META[CATS[c]].color }} />,
                          own[c] > 0 && <i key={`o${c}`} style={{ flexGrow: own[c], background: CAT_META[CATS[c]].color }} />,
                        ])}
                      </span>
                    )}
                    <span className="tt-delay" style={{ left: `calc(${x(arr)} + 6px)` }}>{arrLate >= 15 ? `+${dur(arrLate)}` : 'On time'}</span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <div className={`tt-key ${Classes.TEXT_MUTED}`}>
        <span><i className="tt-key-sched" /> Scheduled</span>
        <span><i className="tt-key-actual" /> Flown</span>
        <span><i className="tt-key-late" /> Late, by root cause</span>
        <span><i className="tt-key-late hatch" style={{ ['--seg' as string]: '#8f99a8' }} /> Inherited from an earlier leg</span>
      </div>
    </Card>
  )
}
