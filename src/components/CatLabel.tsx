import { Icon } from '@blueprintjs/core'
import type { IconName } from '@blueprintjs/icons'

/** A cause name with its Blueprint icon: the only way categories are told apart. */
export default function CatLabel({ icon, children, muted }: { icon: IconName; children: React.ReactNode; muted?: boolean }) {
  return (
    <span className={`cat-label${muted ? ' muted' : ''}`}>
      <Icon icon={icon} size={14} />
      <span>{children}</span>
    </span>
  )
}
