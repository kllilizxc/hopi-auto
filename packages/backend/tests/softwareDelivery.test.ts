import { describe, expect, test } from 'bun:test'
import { SOFTWARE_DELIVERY_CONCURRENCY } from '../src/runtime/softwareDelivery'

describe('software delivery workflow', () => {
  test('owns only global profile capacities, not a stage-to-profile workflow', () => {
    expect(SOFTWARE_DELIVERY_CONCURRENCY).toEqual({
      planner: 3,
      generator: 5,
      reviewer: 3,
    })
  })
})
