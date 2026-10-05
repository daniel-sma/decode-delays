import { Button, MenuItem, Tooltip } from '@blueprintjs/core'
import type { IconName } from '@blueprintjs/icons'
import { Select, type ItemRenderer } from '@blueprintjs/select'

export interface Option<V> { value: V; label: string; count?: number; icon?: IconName }

/**
 * A Blueprint Select used as a table filter. Meant to sit in a ButtonGroup: default button, icon + value,
 * filter name in the tooltip; an active filter shows a blue icon and bold value instead of a filled button.
 */
export default function FilterSelect<V extends string | number | null>({ label, icon, options, value, onChange, searchable, isDefault }: {
  label: string
  icon: IconName
  options: Option<V>[]
  value: V
  onChange: (v: V) => void
  searchable?: boolean
  /** true when `value` is the unfiltered state */
  isDefault: boolean
}) {
  const current = options.find((o) => o.value === value)

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
      <Tooltip content={label} placement="top" hoverOpenDelay={400} openOnTargetFocus={false}>
        <Button
          icon={icon}
          endIcon="caret-down"
          text={current?.label ?? 'Any'}
          className={`filter-btn${isDefault ? '' : ' active'}`}
          aria-label={`${label}: ${current?.label ?? 'Any'}`}
        />
      </Tooltip>
    </Select>
  )
}
