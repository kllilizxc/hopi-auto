import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { selectPeerShortcuts } from '../lib/goalScope'
import {
  compactShortcutLimit,
  compactShortcutRailWidth,
} from '../lib/peerSwitcherLayout'
import { cn } from '../lib/utils'
import { AppTabs, SelectField } from './ui'

const NARROW_SHORTCUT_QUERY = '(max-width: 1180px)'
const SINGLE_SHORTCUT_QUERY =
  '(max-width: 660px), (max-width: 900px) and (max-height: 560px)'

export interface PeerSwitcherItem {
  id: string
  label: string
}

interface PeerSwitcherProps {
  ariaLabel: string
  className?: string
  items: readonly PeerSwitcherItem[]
  label: ReactNode
  moreAriaLabel: string
  onSelectionChange: (id: string) => void
  onWarm?: (id: string) => void
  placeholder?: string
  selectedKey: string
  variant?: 'compact' | 'headline'
}

function viewportShortcutLimit() {
  if (typeof window === 'undefined') return 3
  if (window.matchMedia(SINGLE_SHORTCUT_QUERY).matches) return 1
  if (window.matchMedia(NARROW_SHORTCUT_QUERY).matches) return 2
  return 3
}

function useViewportShortcutLimit(enabled: boolean) {
  const [limit, setLimit] = useState(viewportShortcutLimit)

  useEffect(() => {
    if (!enabled) return

    const media = [
      window.matchMedia(SINGLE_SHORTCUT_QUERY),
      window.matchMedia(NARROW_SHORTCUT_QUERY),
    ]
    const update = () => setLimit(viewportShortcutLimit())
    update()
    media.forEach((query) => query.addEventListener('change', update))
    return () => media.forEach((query) => query.removeEventListener('change', update))
  }, [enabled])

  return limit
}

function useCompactShortcutLimit(itemCount: number, enabled: boolean) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [limit, setLimit] = useState(() => compactShortcutLimit(Number.NaN, itemCount))

  useLayoutEffect(() => {
    if (!enabled || !container) return

    const update = (width = container.getBoundingClientRect().width) => {
      setLimit(compactShortcutLimit(width, itemCount))
    }
    update()

    if (typeof ResizeObserver === 'undefined') {
      const updateFromWindow = () => update()
      window.addEventListener('resize', updateFromWindow)
      return () => window.removeEventListener('resize', updateFromWindow)
    }

    const observer = new ResizeObserver((entries) => {
      update(entries[0]?.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [container, enabled, itemCount])

  return [limit, setContainer] as const
}

export function PeerSwitcher({
  ariaLabel,
  className,
  items,
  label,
  moreAriaLabel,
  onSelectionChange,
  onWarm,
  placeholder = 'No items',
  selectedKey,
  variant = 'compact',
}: PeerSwitcherProps) {
  const viewportLimit = useViewportShortcutLimit(variant === 'headline')
  const [compactLimit, compactContainerRef] = useCompactShortcutLimit(
    items.length,
    variant === 'compact',
  )
  const limit = variant === 'compact' ? compactLimit : viewportLimit
  const orderedItems =
    variant === 'headline'
      ? [
          ...items.filter((item) => item.id === selectedKey),
          ...items.filter((item) => item.id !== selectedKey),
        ]
      : items
  const shortcuts = selectPeerShortcuts(orderedItems, selectedKey, limit, (item) => item.id)
  const shortcutIds = new Set(shortcuts.map((item) => item.id))
  const overflowItems = orderedItems.filter((item) => !shortcutIds.has(item.id))

  return (
    <div
      className={cn(
        'peer-switcher',
        `peer-switcher--${variant}`,
        variant === 'compact' && 'project-switcher',
        className,
      )}
    >
      <span className="peer-switcher__label">{label}</span>
      <div
        ref={variant === 'compact' ? compactContainerRef : undefined}
        className={cn(
          'peer-switcher__controls',
          variant === 'compact' && 'project-switcher__controls',
        )}
      >
        {shortcuts.length ? (
          <AppTabs
            aria-label={ariaLabel}
            className={cn(
              'peer-switcher__tabs',
              variant === 'compact' && 'project-switcher__tabs',
            )}
            style={
              variant === 'compact'
                ? ({
                    '--project-shortcuts-width': `${compactShortcutRailWidth(shortcuts.length)}px`,
                  } as CSSProperties)
                : undefined
            }
            selectedKey={selectedKey}
            onSelectionChange={(key) => {
              const nextKey = String(key)
              if (nextKey !== selectedKey) onSelectionChange(nextKey)
            }}
          >
            <AppTabs.List>
              {shortcuts.map((item) => (
                <AppTabs.Tab
                  className="peer-switcher__tab"
                  id={item.id}
                  key={item.id}
                  onFocus={() => onWarm?.(item.id)}
                  onPointerDown={() => onWarm?.(item.id)}
                  onPointerEnter={() => onWarm?.(item.id)}
                >
                  <span title={item.label}>{item.label}</span>
                </AppTabs.Tab>
              ))}
            </AppTabs.List>
          </AppTabs>
        ) : (
          <span
            className={cn(
              'peer-switcher__placeholder',
              variant === 'compact' && 'project-switcher__placeholder',
            )}
          >
            {placeholder}
          </span>
        )}
        {overflowItems.length > 0 && (
          <SelectField
            aria-label={moreAriaLabel}
            className={cn(
              'peer-switcher__more',
              variant === 'compact' && 'project-switcher__more',
            )}
            onValueChange={onSelectionChange}
            options={overflowItems.map((item) => ({ label: item.label, value: item.id }))}
            popoverClassName={cn(
              'peer-switcher__popover',
              variant === 'compact' && 'project-switcher__popover',
            )}
            value={null}
          />
        )}
      </div>
    </div>
  )
}
