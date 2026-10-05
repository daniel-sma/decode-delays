import { useState } from 'react'
import { CATS, REPORTED, sum } from '../data'
import { CAT_META, REPORTED_META, dur, pct } from '../theme'

interface Seg {
  key: string
  label: string
  color: string
  value: number
  hatch?: boolean
}

/** Two 100% bars: what BTS reports vs what the tail-chain trace decodes. */
export default function CauseCompare({ reported, decoded }: { reported: number[]; decoded: number[] }) {
  const rep: Seg[] = REPORTED.map((k, i) => ({ key: k, ...REPORTED_META[k], value: reported[i] }))
  const dec: Seg[] = CATS.map((k, i) => ({ key: k, label: CAT_META[k].label, color: CAT_META[k].color, value: decoded[i] }))
  return (
    <div className="compare">
      <Bar title="As reported to BTS" segs={rep} />
      <Bar title="Decoded to root cause" segs={dec} />
    </div>
  )
}

function Bar({ title, segs }: { title: string; segs: Seg[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const total = sum(segs.map((s) => s.value))
  const visible = segs.filter((s) => s.value > 0)
  const h = visible.find((s) => s.key === hover)
  return (
    <div className="bar-block">
      <div className="bar-head">
        <span className="bar-title">{title}</span>
        <span className="bar-readout">{h ? `${h.label}: ${dur(h.value)} · ${pct(h.value, total)}` : dur(total)}</span>
      </div>
      <div className="bar" onMouseLeave={() => setHover(null)}>
        {total === 0 && <div className="bar-empty">No cause-coded delay</div>}
        {visible.map((s) => (
          <div
            key={s.key}
            className={`seg${s.hatch ? ' hatch' : ''}${hover && hover !== s.key ? ' dim' : ''}`}
            style={{ flexGrow: s.value, background: s.hatch ? undefined : s.color, ['--seg' as string]: s.color }}
            onMouseEnter={() => setHover(s.key)}
          />
        ))}
      </div>
      <div className="bar-legend">
        {visible.map((s) => (
          <span key={s.key} className={hover === s.key ? 'on' : ''} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
            <i className={s.hatch ? 'hatch' : ''} style={{ background: s.hatch ? undefined : s.color, ['--seg' as string]: s.color }} />
            {s.label} <b>{pct(s.value, total)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
