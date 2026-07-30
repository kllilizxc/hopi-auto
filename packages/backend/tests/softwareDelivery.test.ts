import { describe, expect, test } from 'bun:test'
import { SOFTWARE_DELIVERY_CONCURRENCY, responsibilityFor } from '../src/runtime/softwareDelivery'

describe('software delivery workflow', () => {
  test('owns the fixed responsibility mapping and global capacities in code', () => {
    expect(SOFTWARE_DELIVERY_CONCURRENCY).toEqual({
      planner: 3,
      generator: 5,
      reviewer: 3,
    })
    expect(responsibilityFor('planning', 'plan')).toBe('planner')
    expect(responsibilityFor('engineering', 'generate')).toBe('generator')
    expect(responsibilityFor('engineering', 'review')).toBe('reviewer')
    expect(responsibilityFor('engineering', 'done')).toBeNull()
  })
})
