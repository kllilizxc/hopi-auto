import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectReleaseRef } from '../src/domain/project'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createWorkerContextStager } from '../src/runtime/workerContextStager'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []
afterEach(() =>
  Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
)

describe('WorkerContextStager', () => {
  test('stages a generic Decision Run with Wayfinder authority and one Report destination', async () => {
    const fixture = await createFixture('decision')
    const bundle = await createWorkerContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-question',
      runId: 'R-research',
      workspaceMode: 'none',
      instructionMarkdown: 'Research the named decision only.',
      refs: ['input:EV-1'],
      primaryRepoId: 'primary',
      repoRoots: [{ repoId: 'primary', path: fixture.projectRoot, primary: true }],
    })

    expect(bundle.repoProjection).toBe('release')
    expect(bundle.extraWritableRoots).not.toContain(fixture.projectRoot)
    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('Research the named decision only.')
    expect(prompt).toContain('For Decision Work, answer only the named question')
    expect(prompt).toContain('Finish with one clear natural-language Report')
    expect(await Bun.file(bundle.reposFile).json()).toMatchObject({
      projection: 'release',
      primaryRepoId: 'primary',
      releaseRef: projectReleaseRef('project-1'),
    })
  })

  test('stages Engineering candidate source and a previous Run Report', async () => {
    const fixture = await createFixture('engineering')
    const bundle = await createWorkerContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-build',
      runId: 'R-build-2',
      workspaceMode: 'isolated_write',
      instructionMarkdown: 'Apply the accepted change.',
      refs: [],
      primaryRepoId: 'primary',
      repoRoots: [{ repoId: 'primary', path: fixture.projectRoot, primary: true }],
      previousAttempt: {
        runId: 'R-build-1',
        termination: 'crashed',
        reportMarkdown: 'Partly applied.',
      },
    })
    expect(bundle.repoProjection).toBe('candidate')
    expect(bundle.extraWritableRoots).toContain(fixture.projectRoot)
    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('R-build-1')
    expect(prompt).toContain('Partly applied.')
    expect(prompt).toContain('For Engineering Work, keep changes scoped')
  })
})

async function createFixture(kind: 'decision' | 'engineering') {
  const root = await mkdtemp(join(tmpdir(), 'hopi-worker-context-'))
  temporaryRoots.push(root)
  const homeRoot = join(root, 'home')
  const repoRoot = join(root, 'repo')
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await Bun.write(join(repoRoot, 'src', 'index.ts'), 'export const hello = "hello"\n')
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])
  const home = createAssistantHomeStore(homeRoot)
  await home.initialize()
  const linked = await home.linkProject({ projectId: 'project-1', repoPath: repoRoot })
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({
    goalId: 'goal-1',
    title: 'Test Goal',
    objective: 'Exercise generic Worker staging.',
    ...(kind === 'decision'
      ? {
          mapMarkdown: map(),
          firstWork: {
            id: 'W-question',
            title: 'Resolve the boundary',
            kind: 'decision' as const,
            decisionType: 'research' as const,
            question: 'Where is the boundary?',
          },
        }
      : {
          firstWork: {
            id: 'W-build',
            title: 'Build the change',
            kind: 'engineering' as const,
            objective: 'Build it.',
            acceptanceCriteria: ['It works.'],
          },
        }),
  })
  return { homeRoot, projectRoot: linked.integrationRoot, publisher }
}

function map() {
  return '## Destination\n\nKnow the route.\n\n## Notes\n\nPlan only.\n\n## Decisions so far\n\n## Not yet specified\n\nThe boundary.\n\n## Out of scope\n'
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
