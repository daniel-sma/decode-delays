import { useState } from 'react'
import { Button, Popover, Tooltip } from '@blueprintjs/core'
import type { Summary } from '../data'
import { prettyDate } from '../theme'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Date button that opens a month calendar; only days with exported data can be picked. */
export default function DayPicker({ summary, value, onChange }: { summary: Summary; value: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [y, m] = summary.month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const available = new Set(summary.availableDays)
  const delayed = new Map(summary.days.map((d) => [d.date, d.delayed]))
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const list = summary.availableDays.map((d) => Number(d.slice(8))).join(', ')
  const unavailable = `No data · available ${monthName.split(' ')[0].slice(0, 3)} ${list}`

  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, k) => k + 1)]
  while (cells.length % 7) cells.push(null)

  const calendar = (
    <div className="daypicker">
      <div className="dp-head">
        <Button variant="minimal" size="small" icon="chevron-left" disabled aria-label="Previous month" />
        <strong>{monthName}</strong>
        <Button variant="minimal" size="small" icon="chevron-right" disabled aria-label="Next month" />
      </div>
      <div className="dp-grid" role="grid" aria-label={monthName}>
        {WEEKDAYS.map((w, k) => <span key={k} className="dp-wd">{w}</span>)}
        {cells.map((d, k) => {
          if (d == null) return <span key={k} />
          const iso = `${summary.month}-${String(d).padStart(2, '0')}`
          const ok = available.has(iso)
          const cell = (
            <button
              className={`dp-day${ok ? ' ok' : ''}${iso === value ? ' on' : ''}`}
              aria-disabled={!ok}
              aria-label={ok ? `${prettyDate(iso)}, ${delayed.get(iso)?.toLocaleString('en-US')} delayed flights` : `${prettyDate(iso)}, no data`}
              onClick={() => {
                if (!ok) return setNotice(unavailable)
                onChange(iso)
                setNotice(null)
                setOpen(false)
              }}
            >
              {d}
            </button>
          )
          return ok
            ? <span key={k}>{cell}</span>
            : <Tooltip key={k} content={unavailable} placement="top" hoverOpenDelay={150}>{cell}</Tooltip>
        })}
      </div>
      {notice && <p className="dp-note warn">{notice}</p>}
    </div>
  )

  return (
    <Popover content={calendar} placement="bottom-end" isOpen={open} onInteraction={(next) => { setOpen(next); if (!next) setNotice(null) }}>
      <Button icon="calendar" rightIcon="caret-down" text={prettyDate(value) + `, ${y}`} className="date-button" variant="outlined" />
    </Popover>
  )
}
