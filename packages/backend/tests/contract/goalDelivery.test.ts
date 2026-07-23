import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { RoleRunInput, RoleRunResult } from '../../src/agent/RoleRunner'
import { parseWorkDocument, renderWorkDocument } from '../../src/domain/canonicalDocuments'
import { type MvpServer, createServer } from '../../src/mvpServer'
import {
  ScriptedAssistantRunner,
  ScriptedRoleRunner,
  callAssistantTool,
  requestJson,
  waitForValue,
} from './deterministicHarness'

const PROJECT_ID = 'P-e2e'
const GOAL_ID = 'G-e2e-delivery'
const WORK_ID = 'W-delivery'

interface StateView {
  projects: Array<{
    projectId: string
    repos: Array<{ integrationRoot: string; primary: boolean }>
    goals: Array<{ id: string; lifecycle: string }>
  }>
  activeRuns: Array<{ key: string; responsibility: string }>
}

test('contracts one ordinary Assistant instruction through Planner, Generator, Reviewer, and C1', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-deterministic-e2e-'))
  const repoRoot = join(temporaryRoot, 'repo')
  let server: MvpServer | null = null

  try {
    await initializeFixtureRepo(repoRoot)
    const checkoutBefore = await checkoutSnapshot(repoRoot)
    const assistant = new ScriptedAssistantRunner([
      async (input, observer) => {
        await callAssistantTool(input, observer, 'hopi_create_goal', {
          projectId: PROJECT_ID,
          goalId: GOAL_ID,
          title: 'Deliver deterministic feature',
          objective: 'Change the fixture feature from 1 to 2 and integrate it safely.',
          firstWork: { kind: 'planning' },
        })
        return {
          reply: 'Created the delivery Goal.',
          session: { transport: 'codex', sessionId: 'e2e-main' },
        }
      },
    ])
    const roles = new ScriptedRoleRunner({
      planner: planDelivery,
      generator: generateDelivery,
      reviewer: reviewDelivery,
    })
    server = createServer({
      rootDir: join(temporaryRoot, 'home'),
      port: 0,
      assistantRunner: assistant,
      roleRunner: roles,
    })
    const baseUrl = `http://127.0.0.1:${server.port}`

    const linked = await requestJson<StateView>(baseUrl, '/api/projects', {
      method: 'POST',
      body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: repoRoot },
    })
    const integrationRoot = linked.projects
      .find((project) => project.projectId === PROJECT_ID)
      ?.repos.find((repo) => repo.primary)?.integrationRoot
    expect(integrationRoot).toBeString()

    const inbox = await requestJson<{ eventId: string; status: string }>(baseUrl, '/api/inbox', {
      method: 'POST',
      body: { content: 'Change the fixture feature from 1 to 2.' },
    })
    expect(inbox.status).toBe('pending')

    const settled = await waitForValue(
      () => requestJson<StateView>(baseUrl, '/api/state'),
      (state) =>
        state.projects
          .find((project) => project.projectId === PROJECT_ID)
          ?.goals.find((goal) => goal.id === GOAL_ID)?.lifecycle === 'done' &&
        state.activeRuns.length === 0,
      { description: `${GOAL_ID} to finish with no active responsibility Runs` },
    )
    expect(
      settled.projects
        .find((project) => project.projectId === PROJECT_ID)
        ?.goals.find((goal) => goal.id === GOAL_ID)?.lifecycle,
    ).toBe('done')

    const goal = await requestJson<{
      goal: { lifecycle: string }
      works: Array<{ id: string; stage: string }>
    }>(baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`)
    expect(goal.goal.lifecycle).toBe('done')
    expect(goal.works.find((work) => work.id === WORK_ID)?.stage).toBe('done')

    const feed = await requestJson<{
      items: Array<{
        kind: string
        event?: {
          id: string
          status: string
          reply: string | null
          disposition: string | null
          runtimeEvents: Array<{ kind: string; entryKind?: string; toolName?: string }>
        }
      }>
    }>(baseUrl, '/api/assistant/feed')
    const inboxEntry = feed.items.find((entry) => entry.event?.id === inbox.eventId)
    expect(inboxEntry?.event).toMatchObject({
      status: 'handled',
      reply: 'Created the delivery Goal.',
      disposition: 'tools-used',
    })
    expect(
      inboxEntry?.event?.runtimeEvents.some(
        (event) =>
          event.kind === 'transcript' &&
          event.entryKind === 'tool_call' &&
          event.toolName === 'hopi_create_goal',
      ),
    ).toBe(true)

    const attempts = await requestJson<{
      attempts: Array<{ responsibility: string; status: string; application: string | null }>
    }>(baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/works/${WORK_ID}/attempts`)
    expect(attempts.attempts.map((attempt) => attempt.responsibility).toSorted()).toEqual([
      'generator',
      'reviewer',
    ])
    expect(
      attempts.attempts.find((attempt) => attempt.responsibility === 'generator'),
    ).toMatchObject({ status: 'finished', application: 'published' })
    expect(
      attempts.attempts.find((attempt) => attempt.responsibility === 'reviewer'),
    ).toMatchObject({ status: 'finished', application: 'integrated' })

    expect(roles.responsibilities).toEqual(['planner', 'generator', 'reviewer', 'planner'])
    expect(assistant.modes.filter((mode) => mode === 'main')).toHaveLength(1)
    expect(assistant.remainingPublicScripts).toBe(0)
    expect(await Bun.file(join(integrationRoot as string, 'src', 'feature.ts')).text()).toBe(
      'export const feature = 2\n',
    )
    expect(await Bun.file(join(repoRoot, 'src', 'feature.ts')).text()).toBe(
      'export const feature = 1\n',
    )
    expect(await checkoutSnapshot(repoRoot)).toEqual(checkoutBefore)
  } finally {
    await server?.shutdown()
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}, 30_000)

async function planDelivery(input: RoleRunInput): Promise<RoleRunResult> {
  const goalRoot = join(input.context.proposalRoot, '.hopi', 'docs', 'goals', input.goalId)
  const workRoot = join(goalRoot, 'work')
  const authorityWorkRoot = join(
    input.context.contextRoot,
    'authority',
    '.hopi',
    'docs',
    'goals',
    input.goalId,
    'work',
  )
  const planning = parseWorkDocument(
    await Bun.file(join(authorityWorkRoot, `${input.workId}.md`)).text(),
  )
  const authorityWorks = await Promise.all(
    (await readdir(authorityWorkRoot))
      .filter((path) => path.endsWith('.md'))
      .map((path) => Bun.file(join(authorityWorkRoot, path)).text().then(parseWorkDocument)),
  )
  const engineering = authorityWorks.filter((work) => work.attributes.kind === 'engineering')

  await mkdir(workRoot, { recursive: true })
  if (engineering.length === 0) {
    const primaryRepoId = input.context.repoRoots.find((repo) => repo.primary)?.repoId
    if (!primaryRepoId) throw new Error('Deterministic Planner requires one primary Repo')
    await Bun.write(
      join(workRoot, `${WORK_ID}.md`),
      renderWorkDocument({
        attributes: {
          id: WORK_ID,
          title: 'Set fixture feature to 2',
          kind: 'engineering',
          stage: 'generate',
          notBefore: null,
          dependsOn: [],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: '## Acceptance Criteria\n\n- `src/feature.ts` exports feature with value 2.\n',
      }),
    )
  }

  return successfulResult('Planner staged the deterministic delivery proposal.')
}

async function generateDelivery(input: RoleRunInput): Promise<RoleRunResult> {
  const featurePath = join(input.cwd, 'src', 'feature.ts')
  await mkdir(dirname(featurePath), { recursive: true })
  await Bun.write(featurePath, 'export const feature = 2\n')
  return successfulResult('Generator changed the assigned task worktree.')
}

async function reviewDelivery(input: RoleRunInput): Promise<RoleRunResult> {
  const source = await Bun.file(join(primarySourceRoot(input), 'src', 'feature.ts')).text()
  if (source !== 'export const feature = 2\n') {
    return {
      result: 'reject',
      summary: `Expected feature 2, received ${JSON.stringify(source)}.`,
      artifacts: [],
      exitCode: 0,
    }
  }
  return successfulResult('Reviewer verified the candidate source independently.')
}

function primarySourceRoot(input: RoleRunInput) {
  const root = input.context.repoRoots.find((repo) => repo.primary)?.path
  if (!root) throw new Error('Responsibility context has no primary source root')
  return root
}

function successfulResult(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}

async function initializeFixtureRepo(repoRoot: string) {
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await mkdir(join(repoRoot, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(repoRoot, 'AGENTS.md'), '# Deterministic fixture\n')
  await Bun.write(join(repoRoot, 'src', 'feature.ts'), 'export const feature = 1\n')
  const preparePath = join(repoRoot, 'scripts', 'hopi', 'prepare')
  await Bun.write(preparePath, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(preparePath, 0o755)
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'core.autocrlf', 'false'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI E2E'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial fixture'])
}

async function checkoutSnapshot(repoRoot: string) {
  return {
    head: await git(repoRoot, ['rev-parse', 'HEAD']),
    branch: await git(repoRoot, ['branch', '--show-current']),
    status: await git(repoRoot, ['status', '--porcelain']),
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
  return stdout.trim()
}
