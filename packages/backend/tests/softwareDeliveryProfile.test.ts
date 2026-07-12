import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SoftwareDeliveryProfileError,
  readSoftwareDeliveryProfile,
  responsibilityFor,
} from '../src/runtime/softwareDeliveryProfile'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'software-delivery-profile')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('software delivery profile', () => {
  test('loads the one exact code-owned profile', async () => {
    const profile = await readSoftwareDeliveryProfile()

    expect(profile).toMatchObject({
      version: 1,
      id: 'software-delivery-v1',
      retry: { maxAttempts: 3, exhausted: 'create_attention' },
      concurrency: { planner: 1, generator: 3, reviewer: 1 },
    })
    expect(responsibilityFor('planning', 'plan')).toBe('planner')
    expect(responsibilityFor('engineering', 'generate')).toBe('generator')
    expect(responsibilityFor('engineering', 'review')).toBe('reviewer')
    expect(responsibilityFor('engineering', 'done')).toBeNull()
  })

  test('rejects profile edits that would create a configurable workflow', async () => {
    const path = join(temporaryRoot, 'profile.yml')
    await Bun.write(
      path,
      `version: 1
id: software-delivery-v1
dispatch: []
retry: { maxAttempts: 5, exhausted: create_attention }
concurrency: { planner: 2, generator: 8, reviewer: 2 }
`,
    )

    await expect(readSoftwareDeliveryProfile(path)).rejects.toBeInstanceOf(
      SoftwareDeliveryProfileError,
    )
  })
})
