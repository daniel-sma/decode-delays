import { useMemo, useState } from 'react'
import { Button, Card } from '@blueprintjs/core'
import { CATS, type Day } from '../data'
import { CAT_META, dur, hourLabel } from '../theme'

interface Props {
  day: Day
  hour: number | null
  mode: 'origin' | 'felt'
  playing: boolean
  onHour: (h: number | null) => void
  onPlay: (p: boolean) => void
}

const H = 64

export default function Timeline({ day, hour, mode, playing, onHour, onPlay }: Props) {
  const [hover, setHover] = useState<number | null>(null)

  const hours = useMemo(() => {
    const out = Array.from({ length: day.hours }, () => CATS.map(() => 0))
    for (const a of day.airports) a[mode].forEach((row, c) => row.forEach((v, h) => (out[h][c] += v)))
    return out
  }, [day, mode])
  const max = Math.max(1, ...hours.map((h) => h.reduce((a, b) => a + b, 0)))

  return (
    <Card className="timeline" compact>
      <div className="timeline-controls">
        <Button
          className="play"
          intent="primary"
          size="large"
          icon={playing ? 'pause' : 'play'}
          onClick={() => onPlay(!playing)}
          aria-label={playing ? 'Pause' : 'Play the day'}
        />
        <div className="timeline-readout">
          <div className="timeline-time">{hour == null ? 'All day' : `${hourLabel(hour)}–${hourLabel(hour + 1)} ET`}</div>
          <Button variant="minimal" size="small" className="all-day" onClick={() => onHour(null)} disabled={hour == null} text="Show all day" />
        </div>
      </div>
      <div className="timeline-chart" onMouseLeave={() => setHover(null)}>
        <svg width="100%" height={H + 18} viewBox={`0 0 ${day.hours * 10} ${H + 18}`} preserveAspectRatio="none">
          {hours.map((cats, h) => {
            let y = H
            const total = cats.reduce((a, b) => a + b, 0)
            const dim = hour != null && h !== hour
            return (
              <g key={h} opacity={dim ? 0.45 : 1}>
                {cats.map((v, c) => {
                  if (!v) return null
                  const hgt = (v / max) * (H - 2)
                  y -= hgt
                  return <rect key={c} x={h * 10 + 1} y={y} width={8} height={Math.max(0, hgt - 0.6)} fill={CAT_META[CATS[c]].color} />
                })}
                {total === 0 && <rect x={h * 10 + 1} y={H - 1} width={8} height={1} fill="var(--baseline)" />}
                <rect
                  x={h * 10}
                  y={0}
                  width={10}
                  height={H + 18}
                  fill="transparent"
                  onMouseEnter={() => setHover(h)}
                  onClick={() => {
                    onPlay(false)
                    onHour(h)
                  }}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            )
          })}
          {hour != null && <rect x={hour * 10} y={0} width={10} height={H} fill="none" stroke="var(--ink-1)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="timeline-axis">
          {hours.map((_, h) => (
            <span key={h} style={{ left: `${((h + 0.5) / day.hours) * 100}%` }}>{h % 3 === 0 ? hourLabel(h) : ''}</span>
          ))}
        </div>
        {hover != null && (
          <div className="timeline-tip" style={{ left: `${((hover + 0.5) / day.hours) * 100}%` }}>
            <b>{hourLabel(hover)}–{hourLabel(hover + 1)} ET</b>
            <span>{dur(hours[hover].reduce((a, b) => a + b, 0))} {mode === 'origin' ? 'started' : 'landed'}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
