import { describe, expect, test } from 'bun:test'
import {
  compactShortcutLimit,
  compactShortcutRailWidth,
} from './peerSwitcherLayout'

describe('compact Project shortcut layout', () => {
  test('uses every shortcut that fits without an overflow control', () => {
    expect(compactShortcutLimit(compactShortcutRailWidth(3), 3)).toBe(3)
    expect(compactShortcutLimit(1_000, 7)).toBe(7)
  })

  test('reserves overflow-control space when Projects remain', () => {
    expect(compactShortcutLimit(455, 4)).toBe(3)
    expect(compactShortcutLimit(591, 5)).toBe(4)
    expect(compactShortcutLimit(1_000, 8)).toBe(7)
  })

  test('adapts to narrow containers without hiding the current Project', () => {
    expect(compactShortcutLimit(319, 8)).toBe(2)
    expect(compactShortcutLimit(318, 8)).toBe(1)
    expect(compactShortcutLimit(80, 8)).toBe(1)
  })

  test('uses the stable initial limit until a container can be measured', () => {
    expect(compactShortcutLimit(Number.NaN, 10)).toBe(3)
    expect(compactShortcutLimit(Number.NaN, 2)).toBe(2)
    expect(compactShortcutLimit(Number.NaN, 0)).toBe(0)
  })
})
