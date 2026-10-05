import { useState } from 'react'
import { InputGroup, Menu, MenuDivider, MenuItem } from '@blueprintjs/core'
import type { IconName } from '@blueprintjs/icons'

export interface Choice<V> { value: V; label: string; count?: number; icon?: IconName }

/** One group of choices inside a column-header filter menu. */
function Choices<V>({ items, value, onPick }: { items: Choice<V>[]; value: V; onPick: (v: V) => void }) {
  return (
    <>
      {items.map((c) => (
        <MenuItem
          key={String(c.value)}
          roleStructure="listoption"
          selected={c.value === value}
          icon={c.icon}
          text={c.label}
          label={c.count != null ? c.count.toLocaleString('en-US') : undefined}
          onClick={() => onPick(c.value)}
        />
      ))}
    </>
  )
}

/** A searchable list for long choice sets (airports). Shows the first `limit` matches. */
function SearchableChoices<V>({ items, value, onPick, placeholder, limit = 12 }: {
  items: Choice<V>[]; value: V; onPick: (v: V) => void; placeholder: string; limit?: number
}) {
  const [q, setQ] = useState('')
  const [any, ...rest] = items
  const hits = rest.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      <li className="menu-search">
        <InputGroup small leftIcon="search" placeholder={placeholder} value={q} onValueChange={setQ} autoFocus />
      </li>
      <Choices items={[any, ...hits.slice(0, limit)]} value={value} onPick={onPick} />
      {hits.length > limit && <MenuItem disabled text={`${hits.length - limit} more · keep typing`} roleStructure="listoption" />}
      {hits.length === 0 && <MenuItem disabled text="No matches" roleStructure="listoption" />}
    </>
  )
}

export function SimpleFilterMenu<V>({ title, items, value, onPick }: { title: string; items: Choice<V>[]; value: V; onPick: (v: V) => void }) {
  return (
    <Menu className="header-menu">
      <MenuDivider title={title} />
      <Choices items={items} value={value} onPick={onPick} />
    </Menu>
  )
}

export function SearchFilterMenu<V>({ title, items, value, onPick, placeholder }: {
  title: string; items: Choice<V>[]; value: V; onPick: (v: V) => void; placeholder: string
}) {
  return (
    <Menu className="header-menu">
      <MenuDivider title={title} />
      <SearchableChoices items={items} value={value} onPick={onPick} placeholder={placeholder} />
    </Menu>
  )
}

/** Root cause column: pick a cause, and optionally the airport where it started. */
export function RootCauseMenu<C, A>({ causes, cause, onCause, airports, airport, onAirport }: {
  causes: Choice<C>[]; cause: C; onCause: (v: C) => void
  airports: Choice<A>[]; airport: A; onAirport: (v: A) => void
}) {
  return (
    <Menu className="header-menu">
      <MenuDivider title="Root cause" />
      <Choices items={causes} value={cause} onPick={onCause} />
      <MenuDivider title="Delay started at" />
      <SearchableChoices items={airports} value={airport} onPick={onAirport} placeholder="Search airports" limit={8} />
    </Menu>
  )
}
