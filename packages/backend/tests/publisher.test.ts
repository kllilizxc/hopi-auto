import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { PublicationCoordinator, PublicationError, hashBytes } from '../src/publication/publisher'
import type { PublicationBundle, PublicationRoot } from '../src/publication/types'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'publisher')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('PublicationCoordinator', () => {
  test('validates the complete candidate before installing support and one gate', async () => {
    const root = publicationRoot()
    const coordinator = new PublicationCoordinator()
    const observed: string[] = []
    const bundle: PublicationBundle = {
      root,
      supportingWrites: [write('support/z.md', null, 'z\n'), write('support/a.md', null, 'a\n')],
      gateWrite: write('gate.md', null, 'done\n'),
      async validateCandidate(candidate, current) {
        expect(await candidate.readText('support/a.md')).toBe('a\n')
        expect(await candidate.readText('support/z.md')).toBe('z\n')
        expect(await candidate.readText('gate.md')).toBe('done\n')
        expect(await current.readText('gate.md')).toBeNull()
        observed.push('validated')
      },
    }

    const result = await coordinator.publish(bundle, {
      async afterSupportingWrite(path) {
        observed.push(path)
        expect(await Bun.file(join(root.path, 'gate.md')).exists()).toBe(false)
      },
      beforeGateWrite(path) {
        observed.push(path)
      },
    })

    expect(result.kind).toBe('published')
    expect(observed).toEqual(['validated', 'support/a.md', 'support/z.md', 'validated', 'gate.md'])
    expect(await Bun.file(join(root.path, 'gate.md')).text()).toBe('done\n')
  })

  test('writes nothing when expected hashes or candidate validation fail', async () => {
    const root = publicationRoot()
    const coordinator = new PublicationCoordinator()
    await Bun.write(join(root.path, 'current.md'), 'current\n')

    await expect(
      coordinator.publish({
        root,
        supportingWrites: [write('current.md', null, 'next\n')],
        validateCandidate() {},
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await Bun.file(join(root.path, 'current.md')).text()).toBe('current\n')

    await expect(
      coordinator.publish({
        root,
        supportingWrites: [write('new.md', null, 'new\n')],
        validateCandidate() {
          throw new Error('invalid domain candidate')
        },
      }),
    ).rejects.toThrow('invalid domain candidate')
    expect(await Bun.file(join(root.path, 'new.md')).exists()).toBe(false)
  })

  test('recovers partial supporting writes without reconstructing a missing gate', async () => {
    const root = publicationRoot()
    const coordinator = new PublicationCoordinator()
    const bundle: PublicationBundle = {
      root,
      supportingWrites: [write('a.md', null, 'a\n'), write('b.md', null, 'b\n')],
      gateWrite: write('gate.md', null, 'done\n'),
      validateCandidate() {},
    }

    await expect(
      coordinator.publish(bundle, {
        afterSupportingWrite(_path, index) {
          if (index === 0) {
            throw new Error('simulated process stop')
          }
        },
      }),
    ).rejects.toThrow('simulated process stop')
    expect(await Bun.file(join(root.path, 'a.md')).text()).toBe('a\n')
    expect(await Bun.file(join(root.path, 'b.md')).exists()).toBe(false)
    expect(await Bun.file(join(root.path, 'gate.md')).exists()).toBe(false)

    await expect(coordinator.publish(bundle)).resolves.toMatchObject({ kind: 'published' })
    expect(await Bun.file(join(root.path, 'b.md')).text()).toBe('b\n')
    expect(await Bun.file(join(root.path, 'gate.md')).text()).toBe('done\n')
    await expect(coordinator.publish(bundle)).resolves.toMatchObject({ kind: 'already_current' })
  })

  test('leaves support published but refuses a gate changed before its final guard', async () => {
    const root = publicationRoot()
    const coordinator = new PublicationCoordinator()
    const gatePath = join(root.path, 'gate.md')
    await Bun.write(gatePath, 'open\n')
    const expectedGateHash = await hashBytes(new TextEncoder().encode('open\n'))

    await expect(
      coordinator.publish(
        {
          root,
          supportingWrites: [write('support.md', null, 'support\n')],
          gateWrite: write('gate.md', expectedGateHash, 'done\n'),
          validateCandidate() {},
        },
        {
          async afterSupportingWrite() {
            await Bun.write(gatePath, 'external change\n')
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(await Bun.file(join(root.path, 'support.md')).text()).toBe('support\n')
    expect(await Bun.file(gatePath).text()).toBe('external change\n')
  })

  test('serializes publications and snapshots through one queue', async () => {
    const root = publicationRoot()
    const coordinator = new PublicationCoordinator()
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = coordinator.publish(bundle(root, 'first.md', 'first\n'), {
      async afterSupportingWrite() {
        order.push('first-started')
        await firstMayFinish
        order.push('first-finished')
      },
    })
    await waitFor(() => order.includes('first-started'))
    const second = coordinator.publish(bundle(root, 'second.md', 'second\n')).then(() => {
      order.push('second')
    })
    const snapshot = coordinator.snapshot(root, ['first.md', 'second.md']).then((value) => {
      order.push('snapshot')
      return value
    })
    await Bun.sleep(10)
    expect(order).toEqual(['first-started'])

    releaseFirst()
    await Promise.all([first, second])
    const captured = await snapshot

    expect(order).toEqual(['first-started', 'first-finished', 'second', 'snapshot'])
    expect(captured.files.map((file) => [file.path, decode(file.content)])).toEqual([
      ['first.md', 'first\n'],
      ['second.md', 'second\n'],
    ])
  })

  test('rejects traversal, duplicate paths, and symlink targets', async () => {
    const root = publicationRoot()
    const coordinator = new PublicationCoordinator()

    await expect(coordinator.publish(bundle(root, '../escape.md', 'bad\n'))).rejects.toBeInstanceOf(
      PublicationError,
    )
    await expect(
      coordinator.publish({
        root,
        supportingWrites: [write('same.md', null, 'one\n')],
        gateWrite: write('same.md', null, 'two\n'),
        validateCandidate() {},
      }),
    ).rejects.toMatchObject({ code: 'invalid_bundle' })

    const external = join(temporaryRoot, 'external')
    await mkdir(external)
    await symlink(external, join(root.path, 'linked'))
    await expect(
      coordinator.publish(bundle(root, 'linked/escape.md', 'bad\n')),
    ).rejects.toMatchObject({ code: 'invalid_path' })
  })

  test('accepts exact current hashes for ordinary updates', async () => {
    const root = publicationRoot()
    const coordinator = new PublicationCoordinator()
    const current = new TextEncoder().encode('current\n')
    await Bun.write(join(root.path, 'document.md'), current)

    const result = await coordinator.publish({
      root,
      supportingWrites: [write('document.md', await hashBytes(current), 'next\n')],
      validateCandidate: async (candidate) => {
        expect(await candidate.listFiles()).toEqual(['document.md'])
        expect(await candidate.listFiles('document.md')).toEqual(['document.md'])
        expect(await candidate.exists('document.md')).toBe(true)
      },
    })

    expect(result.kind).toBe('published')
    expect(await Bun.file(join(root.path, 'document.md')).text()).toBe('next\n')
  })
})

function publicationRoot(): PublicationRoot {
  return { id: 'project:P-1', path: temporaryRoot }
}

function write(path: string, expectedHash: string | null, content: string) {
  return { path, expectedHash, content }
}

function bundle(root: PublicationRoot, path: string, content: string): PublicationBundle {
  return {
    root,
    supportingWrites: [write(path, null, content)],
    validateCandidate() {},
  }
}

function decode(content: Uint8Array | null) {
  return content ? new TextDecoder().decode(content) : null
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }
    await Bun.sleep(2)
  }
  throw new Error('condition did not become true')
}
