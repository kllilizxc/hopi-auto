import { describe, expect, test } from 'bun:test'
import { BoundedLineTail } from '../src/runtime/boundedLineTail'

describe('BoundedLineTail', () => {
  test('retains only the newest lines within both limits', () => {
    const tail = new BoundedLineTail(3, 10)

    for (const line of ['111', '222', '333', '444']) tail.push(line)

    expect(tail.values()).toEqual(['222', '333', '444'])
    expect(tail.last()).toBe('444')
    expect(tail.text()).toBe('222\n333\n444')
  })

  test('keeps the diagnostic end of one oversized line', () => {
    const tail = new BoundedLineTail(3, 10)

    tail.push('prefix-final-error')

    expect(tail.values()).toEqual(['…nal-error'])
    expect(tail.text()).toHaveLength(10)
  })
})
