import { Button, MenuItem } from '@blueprintjs/core'
import type { IconName } from '@blueprintjs/icons'
import { Select, type ItemRenderer } from '@blueprintjs/select'

export interface Option<V> { value: V; label: string; count?: number; icon?: IconName }

/** A Blueprint Select used as a table filter: shows "Label: value", highlights when set. */
export default function FilterSelect<V extends string | number | null>({ label, icon, options, value, onChange, searchable }: {
  label: string
  icon: IconName
  options: Option<V>[]
  value: V
  onChange: (v: V) => void
  searchable?: boolean
}) {
  const current = options.find((o) => o.value === value)
  const isSet = value !== null && value !== options[0]?.value

  const render: ItemRenderer<Option<V>> = (o, { handleClick, handleFocus, modifiers }) => {
    if (!modifiers.matchesPredicate) return null
    return (
      <MenuItem
        key={String(o.value)}
        active={modifiers.active}
        roleStructure="listoption"
        selected={o.value === value}
        icon={o.icon}
        text={o.label}
        label={o.count != null ? o.count.toLocaleString('en-US') : undefined}
        onClick={handleClick}
        onFocus={handleFocus}
      />
    )
  }

  return (
    <Select<Option<V>>
      items={options}
      itemRenderer={render}
      itemPredicate={(q, o) => o.label.toLowerCase().includes(q.toLowerCase())}
      onItemSelect={(o) => onChange(o.value)}
      filterable={!!searchable}
      inputProps={{ placeholder: `Search ${label.toLowerCase()}…`, small: true }}
      noResults={<MenuItem disabled text="No matches" roleStructure="listoption" />}
      popoverProps={{ minimal: true, placement: 'bottom-start' }}
      resetOnClose
    >
      <Button
        icon={icon}
        rightIcon="caret-down"
        size="small"
        variant={isSet ? 'solid' : 'outlined'}
        intent={isSet ? 'primary' : 'none'}
        className="filter-btn"
        text={<><span className="filter-label">{label}:</span> {current?.label ?? 'Any'}</>}
      />
    </Select>
  )
}
