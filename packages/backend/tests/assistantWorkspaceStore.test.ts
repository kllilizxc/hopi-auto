import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-workspace-store')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('AssistantWorkspaceStore', () => {
  test('reuses the validated control snapshot until publication advances', async () => {
    const fixture = await setup(false)

    const first = await fixture.store.readWorkspaceForControl()
    expect(await fixture.store.readWorkspaceForControl()).toBe(first)

    await fixture.store.receiveEvent({ eventId: 'EV-control-cache', content: 'New work.' })
    const advanced = await fixture.store.readWorkspaceForControl()
    expect(advanced).not.toBe(first)
    expect(advanced.events.has('EV-control-cache')).toBe(true)

    // Ordinary reads remain fresh and never expose the control-poll cache object.
    expect(await fixture.store.readWorkspace()).not.toBe(advanced)
  })

  test('publishes the complete preference document with optimistic concurrency', async () => {
    const fixture = await setup(false)
    const initial = (await fixture.store.readWorkspace()).preference

    const first = await fixture.store.writePreference(
      '# Preferences\r\n\r\n- Prefer direct answers.',
      initial.digest,
    )
    expect(first).toMatchObject({
      changed: true,
      preference: { content: '# Preferences\n\n- Prefer direct answers.\n' },
    })
    expect(await Bun.file(join(temporaryRoot, fixture.store.paths.preference)).text()).toBe(
      first.preference.content,
    )

    const repeated = await fixture.store.writePreference(
      first.preference.content,
      first.preference.digest,
    )
    expect(repeated.changed).toBe(false)

    await expect(
      fixture.store.writePreference('# Preferences\n\n- Prefer long answers.\n', initial.digest),
    ).rejects.toThrow('changed since this Assistant turn')
    expect((await fixture.store.readWorkspace()).preference).toEqual(first.preference)

    const cleared = await fixture.store.writePreference('', first.preference.digest)
    expect(cleared).toMatchObject({ changed: true, preference: { content: '' } })
  })

  test('publishes image bytes with the Inbox receipt and resolves the durable reference', async () => {
    const fixture = await setup(false)
    const event = await fixture.store.receiveEvent({
      eventId: 'EV-image',
      content: 'Use this screenshot.',
      images: [new File([pngBytes()], 'combat board.png', { type: 'image/png' })],
    })

    expect(event.attributes.attachments).toHaveLength(1)
    const reference = event.attributes.attachments[0]
    if (!reference) throw new Error('Expected image attachment reference')
    expect(reference).toMatch(
      /^\.hopi\/docs\/assistant\/attachments\/[a-f0-9]{64}\/combat-board\.png$/,
    )
    const attachment = await fixture.store.resolveAttachment(reference ?? '')
    expect(attachment).toMatchObject({
      reference,
      fileName: 'combat-board.png',
      mediaType: 'image/png',
    })
    expect(await Bun.file(attachment?.absolutePath ?? '').exists()).toBe(true)
    expect(
      (await fixture.store.readWorkspace()).events.get('EV-image')?.attributes.attachments,
    ).toEqual([reference])
  })

  test('rejects spoofed or unsupported image bytes before creating an Inbox receipt', async () => {
    const fixture = await setup(false)

    await expect(
      fixture.store.receiveEvent({
        eventId: 'EV-invalid',
        content: 'Use this image.',
        images: [new File(['not an image'], 'fake.png', { type: 'image/png' })],
      }),
    ).rejects.toThrow('Unsupported or invalid image')
    expect(await fixture.store.readEvent('EV-invalid')).toBeNull()
  })

  test('persists lossless content and immutable page context before handling', async () => {
    const fixture = await setup(true)
    const event = await fixture.store.receiveEvent({
      eventId: 'EV-1',
      content: 'Ship the preview adapter.\r\nKeep it simple.',
      attachments: ['attachment:brief.md'],
      context: { projectId: 'P-1', goalId: 'G-1' },
      receivedAt: new Date('2026-07-11T00:00:00Z'),
    })

    expect(event.body).toBe('Ship the preview adapter.\nKeep it simple.\n')
    expect((await fixture.store.readEvent('EV-1'))?.attributes.status).toBe('pending')
    const handled = await fixture.store.handleEvent('EV-1', {
      reply: 'I can help with that.',
      disposition: 'answered',
      handledAt: new Date('2026-07-11T00:01:00Z'),
    })

    expect(handled.attributes).toMatchObject({
      status: 'handled',
      context: { projectId: 'P-1', goalId: 'G-1' },
      reply: 'I can help with that.',
      disposition: 'answered',
    })
    expect(handled.attributes.routeClaim).toBeUndefined()
  })

  test('rejects receipt content or page-context rewriting', async () => {
    const fixture = await setup(true)
    await fixture.store.receiveEvent({
      eventId: 'EV-1',
      content: 'Original request.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })

    const path = fixture.store.paths.inboxEvent('EV-1')
    const source = await Bun.file(join(temporaryRoot, path)).text()
    await expect(
      fixture.publisher.publish({
        root: fixture.store.root,
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: source.replace('Original request.', 'Rewritten request.'),
        },
        validateCandidate: async (candidate, current) => {
          const { validateAssistantWorkspaceTransition } = await import(
            '../src/domain/assistantWorkspace'
          )
          await validateAssistantWorkspaceTransition(current, candidate, fixture.store.paths)
        },
      }),
    ).rejects.toThrow('digest mismatch')

    await expect(
      fixture.publisher.publish({
        root: fixture.store.root,
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: source.replace('goalId: G-1', 'goalId: G-2'),
        },
        validateCandidate: async (candidate, current) => {
          const { validateAssistantWorkspaceTransition } = await import(
            '../src/domain/assistantWorkspace'
          )
          await validateAssistantWorkspaceTransition(current, candidate, fixture.store.paths)
        },
      }),
    ).rejects.toThrow('receipt is immutable')
  })

  test('keeps Reflection turns internal until the speaking thread exposes them', async () => {
    const fixture = await setup(true)
    const user = await fixture.store.receiveEvent({ eventId: 'EV-user', content: 'Hello.' })
    const reflection = await fixture.store.receiveReflectionEvent({
      eventId: 'EV-reflection',
      content: 'Work W-1 needs diagnosis.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })

    expect(user.attributes).toMatchObject({ source: 'user', visibility: 'public' })
    expect(reflection.attributes).toMatchObject({ source: 'reflection', visibility: 'internal' })
    expect((await fixture.store.exposeEvent('EV-reflection')).attributes.visibility).toBe('public')
    await expect(fixture.store.exposeEvent('EV-user')).rejects.toThrow(
      'Only Reflection turns can be exposed',
    )
    await fixture.store.handleEvent('EV-reflection', {
      reply: 'The operator should inspect W-1.',
      disposition: 'notified',
    })
    await expect(fixture.store.exposeEvent('EV-reflection')).rejects.toThrow(
      'Handled Reflection turns cannot be exposed',
    )
  })

  test('uses Workspace Attention as the sole durable operator blocker', async () => {
    const fixture = await setup(true)
    await fixture.store.receiveEvent({ eventId: 'EV-1', content: 'Ambiguous request.' })
    const attention = {
      attributes: {
        id: 'A-event',
        target: `home:${fixture.homeId}/event:EV-1`,
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: '## Needs you\n\nWhich Project owns this request?\n',
    }

    await fixture.store.createAttention(attention)
    const notified = await fixture.store.markAttentionNotified(
      'A-event',
      new Date('2026-07-11T00:01:00Z'),
    )
    const resolved = await fixture.store.resolveAttention(
      'A-event',
      'Answered by EV-2.',
      new Date('2026-07-11T00:02:00Z'),
    )

    expect(notified.attributes.resolvedAt).toBeNull()
    expect(resolved.attributes.resolvedAt).toBe('2026-07-11T00:02:00.000Z')
    expect(resolved.body).toContain('## Resolution')
  })

  test('permits only one open project-target Attention', async () => {
    const fixture = await setup(true)
    const attention = (id: string) => ({
      attributes: {
        id,
        target: 'project:P-1',
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: '## Needs you\n\nProject root is invalid.\n',
    })
    await fixture.store.createAttention(attention('A-project-1'))

    await expect(fixture.store.createAttention(attention('A-project-2'))).rejects.toThrow(
      'More than one open',
    )
    expect(
      await Bun.file(join(temporaryRoot, fixture.store.paths.attention('A-project-2'))).exists(),
    ).toBe(false)
  })

  test('publication can retry a receipt left installed before durability acknowledgement', async () => {
    const fixture = await setup(false)
    let acknowledged = false
    const bundle = {
      root: fixture.store.root,
      supportingWrites: [],
      gateWrite: {
        path: '.hopi/durable-receipt-test',
        expectedHash: null,
        content: 'durable receipt\n',
      },
      validateCandidate: () => undefined,
    }
    await expect(
      fixture.publisher.publishDurableReceipt(bundle, {
        afterGateWrite() {
          throw new Error('process stopped before durable acknowledgement')
        },
      }),
    ).rejects.toThrow('process stopped')
    expect(acknowledged).toBe(false)

    await fixture.publisher.publishDurableReceipt(bundle)
    acknowledged = true
    expect(acknowledged).toBe(true)
  })
})

async function setup(linkProject: boolean) {
  const home = createAssistantHomeStore(temporaryRoot)
  const homeDocument = await home.initialize()
  if (linkProject) {
    const repo = join(temporaryRoot, 'repo')
    await mkdir(repo, { recursive: true })
    await git(repo, ['init', '-b', 'main'])
    await git(repo, ['config', 'user.email', 'hopi@example.test'])
    await git(repo, ['config', 'user.name', 'HOPI Test'])
    await Bun.write(join(repo, 'README.md'), '# Repo\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-m', 'initial'])
    await home.linkProject({ projectId: 'P-1', repoPath: repo })
  }
  const publisher = new PublicationCoordinator()
  return {
    homeId: homeDocument.homeId,
    publisher,
    store: createAssistantWorkspaceStore(temporaryRoot, publisher),
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
}

function pngBytes() {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
}
