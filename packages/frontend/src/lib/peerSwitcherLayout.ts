const COMPACT_SHORTCUT_WIDTH = 136
const COMPACT_RAIL_CHROME_WIDTH = 4
const COMPACT_OVERFLOW_WIDTH = 38
const COMPACT_CONTROL_GAP = 5
const DEFAULT_SHORTCUT_LIMIT = 3

export function compactShortcutRailWidth(shortcutCount: number) {
  return COMPACT_RAIL_CHROME_WIDTH + Math.max(0, shortcutCount) * COMPACT_SHORTCUT_WIDTH
}

export function compactShortcutLimit(availableWidth: number, itemCount: number) {
  const count = Math.max(0, Math.floor(itemCount))
  if (count === 0) return 0
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return Math.min(DEFAULT_SHORTCUT_LIMIT, count)
  }

  if (compactShortcutRailWidth(count) <= availableWidth) return count

  const shortcutWidth =
    availableWidth -
    COMPACT_OVERFLOW_WIDTH -
    COMPACT_CONTROL_GAP -
    COMPACT_RAIL_CHROME_WIDTH
  const fittingCount = Math.floor(shortcutWidth / COMPACT_SHORTCUT_WIDTH)
  return Math.max(1, Math.min(count, fittingCount))
}
