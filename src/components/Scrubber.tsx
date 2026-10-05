import { useMemo, useRef, useState } from 'react'
import { Button, Tooltip, useHotkeys } from '@blueprintjs/core'
import { flightLabel, route, type Day } from '../data'
import { dur } from '../theme'

export const SPEEDS = [1, 2, 4, 8, 16]

/** Minutes relative to midnight ET → "14:05" (24h, like an ops console). */
export function clock24(min: number) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Day offset badge for times past midnight ("+1") or before it ("−1"). */
export function dayOffset(min: number) {
  const d = Math.floor(min / 1440)
  return d === 0 ? '' : d > 0 ? `+${d}` : `−${-d}`
}

const nice = (x: number, steps: number[]) => steps.find((s) => s >= x) ?? steps[steps.length - 1]

export interface Window { t0: number; t1: number }

/** Time span of an aircraft's day, padded to whole hours. */
export function chainWindow(day: Day, chain: number[]): Window {
  const f = day.flights
  const flown = chain.filter((i) => !f.status[i].startsWith('C'))
  const legs = flown.length ? flown : chain
  const start = Math.min(...legs.map((i) => f.sdep[i]))
  const end = Math.max(...legs.map((i) => f.sarr[i] + Math.max(0, f.arrDelay[i] ?? 0)))
  return { t0: Math.floor((start - 30) / 60) * 60, t1: Math.ceil((end + 30) / 60) * 60 }
}

export const actualDep = (day: Day, i: number) => day.flights.sdep[i] + Math.max(0, day.flights.depDelay[i] ?? 0)
export const actualArr = (day: Day, i: number) => day.flights.sarr[i] + (day.flights.arrDelay[i] ?? 0)

/**
 * How late the aircraft is against its schedule at minute t: on the ground it is the overrun past the next
 * scheduled departure; in the air it moves from the departure delay to the arrival delay.
 */
function lateness(day: Day, legs: number[], t: number): { late: number; leg: number | null } {
  const f = day.flights
  for (let k = 0; k < legs.length; k++) {
    const i = legs[k]
    const dep = actualDep(day, i), arr = actualArr(day, i)
    if (t < dep) return { late: Math.max(0, t - f.sdep[i]), leg: i }
    if (t <= arr) {
      const p = arr > dep ? (t - dep) / (arr - dep) : 1
      const d0 = Math.max(0, f.depDelay[i] ?? 0), d1 = Math.max(0, f.arrDelay[i] ?? 0)
      return { late: d0 + (d1 - d0) * p, leg: i }
    }
  }
  return { late: 0, leg: null }
}

interface Props {
  day: Day
  chain: number[]
  win: Window
  time: number
  playing: boolean
  speed: number
  onTime: (t: number) => void
  onPlay: (p: boolean) => void
  onSpeed: (s: number) => void
  hoverLeg: number | null
  onHoverLeg: (i: number | null) => void
  onPickLeg: (i: number) => void
}

/** Ops-console style scrubber: transport controls, an hour ruler, lateness histogram and a playhead. */
export default function Scrubber({ day, chain, win, time, playing, speed, onTime, onPlay, onSpeed, hoverLeg, onHoverLeg, onPickLeg }: Props) {
  const f = day.flights
  const track = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const legs = useMemo(() => chain.filter((i) => !f.status[i].startsWith('C')), [chain, f])
  const span = win.t1 - win.t0
  const pct = (t: number) => `${((t - win.t0) / span) * 100}%`

  // Scale ticks, labels and bar width to the length of the plane's day (some run past 24h).
  const labelEvery = nice(span / 8, [60, 120, 180, 360, 720])
  const minorEvery = nice(span / 100, [10, 15, 30, 60])
  const BUCKET = nice(span / 160, [5, 10, 15, 20, 30])

  const bars = useMemo(() => {
    const out: { t: number; late: number }[] = []
    for (let t = win.t0; t < win.t1; t += BUCKET) out.push({ t, late: lateness(day, legs, t + BUCKET / 2).late })
    return out
  }, [day, legs, win, BUCKET])
  const maxLate = Math.max(60, ...bars.map((b) => b.late)) * 1.1
  const yStep = nice(maxLate / 2.6, [15, 30, 60, 120, 240, 360, 720])

  const events = useMemo(() => legs.flatMap((i) => [actualDep(day, i), actualArr(day, i)]).sort((a, b) => a - b), [day, legs])
  const clamp = (t: number) => Math.max(win.t0, Math.min(win.t1, t))
  const prevEvent = () => onTime(clamp([...events].reverse().find((e) => e < time - 0.5) ?? win.t0))
  const nextEvent = () => onTime(clamp(events.find((e) => e > time + 0.5) ?? win.t1))
  const si = SPEEDS.indexOf(speed)

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return clamp(win.t0 + ((clientX - r.left) / r.width) * span)
  }

  const hours: number[] = []
  for (let t = Math.ceil(win.t0 / labelEvery) * labelEvery; t <= win.t1; t += labelEvery) hours.push(t)
  const minors: number[] = []
  for (let t = Math.ceil(win.t0 / minorEvery) * minorEvery; t <= win.t1; t += minorEvery) if (t % labelEvery) minors.push(t)
  const now = lateness(day, legs, time)

  const togglePlay = () => { if (!playing && time >= win.t1) onTime(win.t0); onPlay(!playing) }
  const slower = () => si > 0 && onSpeed(SPEEDS[si - 1])
  const faster = () => si < SPEEDS.length - 1 && onSpeed(SPEEDS[si + 1])
  // Keyboard playback anywhere on the flight page ("?" lists every shortcut). The hotkeys are registered
  // once and call the latest handlers through a ref, so playback ticks don't re-register them.
  const keys = useRef({ togglePlay, slower, faster, prevEvent, nextEvent, step: (d: number) => onTime(clamp(time + d)), start: () => onTime(win.t0) })
  keys.current = { togglePlay, slower, faster, prevEvent, nextEvent, step: (d: number) => onTime(clamp(time + d)), start: () => onTime(win.t0) }
  const hotkeys = useMemo(() => {
    const k = (combo: string, label: string, run: () => void) =>
      ({ combo, label, global: true, group: 'Playback', preventDefault: true, onKeyDown: run })
    return [
      k('space', 'Play / pause', () => keys.current.togglePlay()),
      k('left', 'Back 5 min', () => keys.current.step(-5)),
      k('right', 'Forward 5 min', () => keys.current.step(5)),
      k('shift+left', 'Back 15 min', () => keys.current.step(-15)),
      k('shift+right', 'Forward 15 min', () => keys.current.step(15)),
      k('[', 'Previous departure or arrival', () => keys.current.prevEvent()),
      k(']', 'Next departure or arrival', () => keys.current.nextEvent()),
      k('-', 'Slower', () => keys.current.slower()),
      k('=', 'Faster', () => keys.current.faster()),
      k('home', 'Start of day', () => keys.current.start()),
    ]
  }, [])
  useHotkeys(hotkeys)

  return (
    <div className="scrubber">
      <div className="scrub-bar">
        <div className="scrub-clock">
          <span className="scrub-time">{clock24(time)}</span>
          <span className="scrub-tz">ET{dayOffset(time) && <sup> {dayOffset(time)}d</sup>}</span>
          <span className="scrub-sep" />
          <span className="scrub-late">{now.late >= 1 ? <>Running <b>{dur(now.late)}</b> late</> : 'On schedule'}</span>
        </div>
        <div className="scrub-transport">
          <Tooltip content="Start of day · Home" placement="top"><Button variant="minimal" size="small" icon="step-backward" onClick={() => onTime(win.t0)} aria-label="Start of day" /></Tooltip>
          <Tooltip content="Slower · −" placement="top"><Button variant="minimal" size="small" icon="fast-backward" text={`${SPEEDS[Math.max(0, si - 1)]}x`} disabled={si <= 0} onClick={() => onSpeed(SPEEDS[si - 1])} /></Tooltip>
          <Tooltip content="Back 15 min · Shift+←" placement="top"><Button variant="minimal" size="small" icon="undo" text="15m" onClick={() => onTime(clamp(time - 15))} /></Tooltip>
          <Tooltip content="Previous departure or arrival · [" placement="top"><Button variant="minimal" size="small" icon="chevron-left" onClick={prevEvent} aria-label="Previous event" /></Tooltip>
          <Button intent="primary" size="small" icon={playing ? 'pause' : 'play'} text={playing ? 'Pause' : 'Play'} className="scrub-play" onClick={togglePlay} title="Play / pause · Space" />
          <Tooltip content="Next departure or arrival · ]" placement="top"><Button variant="minimal" size="small" icon="chevron-right" onClick={nextEvent} aria-label="Next event" /></Tooltip>
          <Tooltip content="Forward 15 min · Shift+→" placement="top"><Button variant="minimal" size="small" icon="redo" text="15m" onClick={() => onTime(clamp(time + 15))} /></Tooltip>
          <Tooltip content="Faster · =" placement="top"><Button variant="minimal" size="small" rightIcon="fast-forward" text={`${SPEEDS[Math.min(SPEEDS.length - 1, si + 1)]}x`} disabled={si >= SPEEDS.length - 1} onClick={() => onSpeed(SPEEDS[si + 1])} /></Tooltip>
        </div>
        <div className="scrub-meta">
          <span className="scrub-speed">{speed}x</span>
        </div>
      </div>

      <div className="scrub-body">
        <div className="scrub-y">
          {[1, 2].filter((k) => k * yStep < maxLate).map((k) => <span key={k} style={{ bottom: `${((k * yStep) / maxLate) * 100}%` }}>{dur(k * yStep)}</span>)}
        </div>
        <div
          className="scrub-track"
          ref={track}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onPlay(false); onTime(timeAt(e.clientX)) }}
          onPointerMove={(e) => { setHover(timeAt(e.clientX)); if (e.buttons === 1) onTime(timeAt(e.clientX)) }}
          onPointerLeave={() => setHover(null)}
          role="slider"
          aria-label="Time of day"
          aria-valuemin={win.t0}
          aria-valuemax={win.t1}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock24(time)} ET`}
          tabIndex={0}
        >
          <div className="scrub-ruler">
            {minors.map((t) => <span key={t} className="tick minor" style={{ left: pct(t) }} />)}
            {hours.map((t) => <span key={t} className="tick major" style={{ left: pct(t) }}><em>{clock24(t)}{dayOffset(t) && <sup>{dayOffset(t)}</sup>}</em></span>)}
          </div>
          <div className="scrub-legs">
            {legs.map((i) => (
              <span
                key={i}
                className={`leg${i === hoverLeg ? ' hovered' : ''}`}
                style={{ left: pct(actualDep(day, i)), width: `calc(${pct(actualArr(day, i))} - ${pct(actualDep(day, i))})` }}
                // Hovering a leg names it and highlights it in the sidebar; clicking opens it there.
                onPointerEnter={() => onHoverLeg(i)}
                onPointerLeave={() => onHoverLeg(null)}
                onPointerDown={(e) => { e.stopPropagation(); onPickLeg(i) }}
              >
                <em>{route(day, i)}</em>
              </span>
            ))}
          </div>
          {hoverLeg != null && legs.includes(hoverLeg) && <LegTip day={day} i={hoverLeg} at={(actualDep(day, hoverLeg) + actualArr(day, hoverLeg)) / 2} win={win} />}
          <div className="scrub-hist">
            {[1, 2].filter((k) => k * yStep < maxLate).map((k) => <span key={k} className="grid" style={{ bottom: `${((k * yStep) / maxLate) * 100}%` }} />)}
            {bars.map((b) => b.late >= 1 && (
              <span
                key={b.t}
                className={`bar${b.t + BUCKET <= time ? ' past' : ''}`}
                style={{ left: pct(b.t), width: `calc(${(BUCKET / span) * 100}% - 1px)`, height: `${(b.late / maxLate) * 100}%` }}
              />
            ))}
          </div>
          {hover != null && hoverLeg == null && <span className="scrub-hover" style={{ left: pct(hover) }}><em>{clock24(hover)}</em></span>}
          <span className="scrub-head" style={{ left: pct(time) }}>
            <i />
            <em>{clock24(time)}</em>
          </span>
        </div>
      </div>
    </div>
  )
}

/** Card under a hovered timeline leg: flight, route and actual times, kept inside the track. */
function LegTip({ day, i, at, win }: { day: Day; i: number; at: number; win: Window }) {
  const x = (at - win.t0) / (win.t1 - win.t0)
  const shift = x < 0.12 ? '0%' : x > 0.88 ? '-100%' : '-50%'
  const dep = actualDep(day, i), arr = actualArr(day, i)
  const late = day.flights.arrDelay[i] ?? 0
  return (
    <span className="leg-tip" style={{ left: `${x * 100}%`, transform: `translateX(${shift})` }}>
      <b>{flightLabel(day, i)}</b> {route(day, i)}
      <span>{clock24(dep)}{dayOffset(dep) && <sup>{dayOffset(dep)}</sup>} – {clock24(arr)}{dayOffset(arr) && <sup>{dayOffset(arr)}</sup>}{late >= 15 && <em> +{dur(late)}</em>}</span>
    </span>
  )
}
