import { HTMLTable } from '@blueprintjs/core'
import { CATS, REPORTED, sum } from '../data'
import { CAT_META, REPORTED_META, dur, pct } from '../theme'
import CatLabel from './CatLabel'

/** What BTS reports vs what the tail-chain trace decodes, as two ranked lists with bars. */
export default function CauseCompare({ reported, decoded }: { reported: number[]; decoded: number[] }) {
  const rep = REPORTED.map((k, i) => ({ key: k, icon: REPORTED_META[k].icon, label: REPORTED_META[k].label, value: reported[i] }))
  const dec = CATS.map((k, i) => ({ key: k, icon: CAT_META[k].icon, label: CAT_META[k].label, value: decoded[i] }))
  return (
    <div className="compare">
      <List title="As reported to BTS" rows={rep} />
      <List title="Decoded to root cause" rows={dec} />
    </div>
  )
}

function List({ title, rows }: { title: string; rows: { key: string; icon: Parameters<typeof CatLabel>[0]['icon']; label: string; value: number }[] }) {
  const total = sum(rows.map((r) => r.value))
  const shown = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value)
  return (
    <div className="compare-list">
      <div className="compare-head"><span>{title}</span><span>{dur(total)}</span></div>
      <HTMLTable compact className="compare-table">
        <tbody>
          {shown.map((r) => (
            <tr key={r.key}>
              <td><CatLabel icon={r.icon}>{r.label}</CatLabel></td>
              <td className="compare-bar-cell"><span className="meter"><span style={{ width: pct(r.value, total) }} /></span></td>
              <td className="num">{pct(r.value, total)}</td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  )
}
