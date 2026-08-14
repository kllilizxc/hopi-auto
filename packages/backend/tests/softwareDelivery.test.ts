import { expect, test } from 'bun:test'
import { WORKER_CONCURRENCY } from '../src/runtime/softwareDelivery'

test('delivery owns one generic Worker capacity', () => {
  expect(WORKER_CONCURRENCY).toBe(5)
})
