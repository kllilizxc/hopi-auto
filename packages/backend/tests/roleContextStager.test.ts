import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWorkDocument, renderWorkDocument } from '../src/domain/canonicalDocuments'
import { projectReleaseRef } from '../src/domain/project'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createRoleContextStager } from '../src/runtime/roleContextStager'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('RoleContextStager', () => {
  test('stages an explicit Planner Run with release source, refs, and one Report destination', async () => {
    const fixture = await createFixture()
    const stager = createRoleContextStager(fixture.homeRoot, fixture.publisher)

    const bundle = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-plan',
      responsibility: 'planner',
      workspaceMode: 'none',
      instructionMarkdown: 'Assess the smallest implementation boundary.',
      refs: ['owner-message:evt-1'],
      primaryRepoId: 'primary',
      repoRoots: [{ repoId: 'primary', path: fixture.projectRoot, primary: true }],
      apiOrigin: 'http://127.0.0.1:3000/internal/path',
    })

    expect(bundle.repoProjection).toBe('release')
    expect(bundle.bootstrapSourceRoot).toBeDefined()
    expect(bundle.extraWritableRoots).not.toContain(fixture.projectRoot)
    expect(await Bun.file(bundle.reportFile).text()).toBe('')

    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('Assess the smallest implementation boundary.')
    expect(prompt).toContain('## Planner profile')
    expect(prompt).toContain('requested decision ticket—the current frontier')
    expect(prompt).toContain('resolve one decision with evidence')
    expect(prompt).toContain('record remaining fog and newly visible tickets')
    expect(prompt).toContain('Produce decisions, not deliverables')
    expect(prompt).toContain('Research is AFK; prototype and grilling are HITL')
    expect(prompt).toContain('a task only unblocks a decision')
    expect(prompt).toContain('HITL stays open until the operator speaks')
    expect(prompt).toContain('product source remains unchanged')
    expect(prompt).toContain('$HOPI_REPORT_FILE')
    expect(prompt).toContain('Do not return a terminal JSON result, Operation, ChangeSet')
    expect(prompt).not.toContain('HOPI_PROPOSAL')

    const context = await Bun.file(bundle.contextFile).text()
    expect(context).toContain('owner-message:evt-1')
    expect(context).toContain('Repo workspace projection: release')
    expect(context).toContain('HOPI public API origin: http://127.0.0.1:3000')

    expect(await Bun.file(bundle.reposFile).json()).toMatchObject({
      projection: 'release',
      primaryRepoId: 'primary',
      releaseRef: projectReleaseRef('project-1'),
      repos: { primary: fixture.projectRoot },
    })
  })

  test('stages an isolated Generator Run on candidate source and includes the previous Report', async () => {
    const fixture = await createFixture()
    await publishEngineeringWork(fixture)
    const stager = createRoleContextStager(fixture.homeRoot, fixture.publisher)

    const bundle = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-build-2',
      responsibility: 'generator',
      workspaceMode: 'isolated_write',
      instructionMarkdown: 'Apply the requested source change.',
      refs: ['run:run-build-1'],
      primaryRepoId: 'primary',
      repoRoots: [{ repoId: 'primary', path: fixture.projectRoot, primary: true }],
      previousAttempt: {
        runId: 'run-build-1',
        responsibility: 'generator',
        termination: 'crashed',
        reportMarkdown: 'The source edit was partly applied before the process exited.',
      },
    })

    expect(bundle.repoProjection).toBe('candidate')
    expect(bundle.extraWritableRoots).toContain(fixture.projectRoot)
    expect(bundle.guardPrefixes).toEqual([fixture.store.paths.designRoot('goal-1')])

    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('## Generator profile')
    expect(prompt).toContain('run-build-1')
    expect(prompt).toContain('Termination: crashed')
    expect(prompt).toContain('The source edit was partly applied before the process exited.')
    expect(prompt).toContain('A settled Run is never resumed.')
  })

  test('keeps Reviewer source read-only and rejects non-Engineering Work', async () => {
    const fixture = await createFixture()
    const stager = createRoleContextStager(fixture.homeRoot, fixture.publisher)

    await expect(
      stager.prepare({
        projectRoot: fixture.projectRoot,
        projectId: 'project-1',
        goalId: 'goal-1',
        workId: 'plan-initial',
        runId: 'run-review-invalid',
        responsibility: 'reviewer',
        workspaceMode: 'read_only',
        instructionMarkdown: 'Review the current candidate.',
        refs: [],
        primaryRepoId: 'primary',
        repoRoots: [{ repoId: 'primary', path: fixture.projectRoot, primary: true }],
      }),
    ).rejects.toThrow('reviewer requires Engineering Work')

    await publishEngineeringWork(fixture)
    const bundle = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-review',
      responsibility: 'reviewer',
      workspaceMode: 'read_only',
      instructionMarkdown: 'Review the candidate independently.',
      refs: [],
      primaryRepoId: 'primary',
      repoRoots: [{ repoId: 'primary', path: fixture.projectRoot, primary: true }],
    })

    expect(bundle.repoProjection).toBe('candidate')
    expect(bundle.extraWritableRoots).not.toContain(fixture.projectRoot)
    expect(await Bun.file(bundle.promptFile).text()).toContain('## Reviewer profile')
  })
})

async function createFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-role-context-'))
  temporaryRoots.push(temporaryRoot)
  const homeRoot = join(temporaryRoot, 'home')
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await Bun.write(join(repoRoot, 'src', 'index.ts'), 'export const hello = "hello"\n')
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const homeStore = createAssistantHomeStore(homeRoot)
  await homeStore.initialize()
  const linked = await homeStore.linkProject({ projectId: 'project-1', repoPath: repoRoot })
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({
    goalId: 'goal-1',
    title: 'Test Goal',
    objective: 'Exercise explicit Run context staging.',
  })
  return { homeRoot, projectRoot: linked.integrationRoot, publisher, store }
}

async function publishEngineeringWork(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
  const source = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
  const planning = parseWorkDocument(source)
  planning.attributes.stage = 'done'
  await fixture.store.publishGoal('goal-1', {
    supportingWrites: [
      {
        path: fixture.store.paths.workDocument('goal-1', 'W-1'),
        expectedHash: null,
        content: renderWorkDocument({
          attributes: {
            id: 'W-1',
            title: 'Engineering Work',
            kind: 'engineering',
            stage: 'generate',
            notBefore: null,
            dependsOn: [],
            contractRevision: 1,
            evidenceRefs: [],
            contextRefs: [],
            ownerMessages: [],
          },
          body: '## Acceptance Criteria\n\n- The implementation is verified.\n',
        }),
      },
    ],
    gateWrite: {
      path: planningPath,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkDocument(planning),
    },
  })
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
