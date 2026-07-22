import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { RoleRunInput, RoleRunResult, RoleRunner } from '../../src/agent/RoleRunner'
import {
  parseEvidenceDocument,
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../../src/domain/canonicalDocuments'
import { type MvpServer, createServer } from '../../src/mvpServer'
import { requestJson, waitForValue } from './deterministicHarness'

const PROJECT_ID = 'P-evidence-handoff'
const GOAL_ID = 'G-evidence-handoff'
const PRODUCE_WORK = 'W-produce'
const CONSUME_WORK = 'W-consume'

interface StateView {
  projects: Array<{
    projectId: string
    repos: Array<{ integrationRoot: string; primary: boolean }>
    goals: Array<{ id: string; lifecycle: string }>
  }>
  activeRuns: Array<{ key: string; responsibility: string }>
}

interface HandoffObservation {
  artifactReference: string
  artifactPath: string
  evidencePaths: string[]
  manifestPath: string
  predecessorStage: string
}

test('hands accepted dependency Evidence and immutable Run artifacts to downstream Work', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-evidence-handoff-'))
  const repoRoot = join(temporaryRoot, 'repo')
  const roles = createHandoffRoles()
  let server: MvpServer | null = null

  try {
    await initializeFixtureRepo(repoRoot)
    const checkoutBefore = await checkoutSnapshot(repoRoot)
    server = createServer({
      rootDir: join(temporaryRoot, 'home'),
      port: 0,
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

    await requestJson(baseUrl, `/api/projects/${PROJECT_ID}/goals`, {
      method: 'POST',
      body: {
        goalId: GOAL_ID,
        title: 'Consume accepted predecessor proof',
        objective:
          'Produce one reviewed fact, then use only its canonical Evidence and immutable artifact in dependent Work.',
      },
    })

    await waitForValue(
      () => requestJson<StateView>(baseUrl, '/api/state'),
      (state) =>
        state.projects
          .find((project) => project.projectId === PROJECT_ID)
          ?.goals.find((goal) => goal.id === GOAL_ID)?.lifecycle === 'done' &&
        state.activeRuns.length === 0,
      { description: `${GOAL_ID} to finish after its dependency handoff` },
    )

    const detail = await requestJson<{
      goal: { lifecycle: string }
      works: Array<{
        id: string
        stage: string
        dependsOn: string[]
        evidenceRefs: string[]
      }>
    }>(baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`)
    expect(detail.goal.lifecycle).toBe('done')
    expect(detail.works.find((work) => work.id === PRODUCE_WORK)).toMatchObject({
      stage: 'done',
      dependsOn: [],
    })
    expect(detail.works.find((work) => work.id === CONSUME_WORK)).toMatchObject({
      stage: 'done',
      dependsOn: [PRODUCE_WORK],
    })
    expect(detail.works.find((work) => work.id === PRODUCE_WORK)?.evidenceRefs).toHaveLength(2)
    expect(detail.works.find((work) => work.id === CONSUME_WORK)?.evidenceRefs).toHaveLength(2)

    expect(roles.invocations).toEqual([
      'planner:plan-initial',
      `generator:${PRODUCE_WORK}`,
      `reviewer:${PRODUCE_WORK}`,
      `generator:${CONSUME_WORK}`,
      `reviewer:${CONSUME_WORK}`,
      'planner:plan-0002',
    ])
    expect(roles.handoff).not.toBeNull()
    expect(roles.handoff?.predecessorStage).toBe('done')
    expect(roles.handoff?.artifactReference).toMatch(/^artifact:R-[^/]+\/001-proof\.txt$/)
    expect(await Bun.file(roles.handoff?.artifactPath ?? '').text()).toBe(
      'accepted predecessor value: 41\n',
    )
    expect((await stat(roles.handoff?.manifestPath ?? '')).mode & 0o222).toBe(0)
    expect(roles.handoff?.evidencePaths).toHaveLength(2)

    const canonicalGoalRoot = join(integrationRoot as string, '.hopi', 'docs', 'goals', GOAL_ID)
    const evidenceDocuments = await Promise.all(
      (await readdir(join(canonicalGoalRoot, 'evidence'))).map((name) =>
        Bun.file(join(canonicalGoalRoot, 'evidence', name))
          .text()
          .then(parseEvidenceDocument),
      ),
    )
    expect(
      evidenceDocuments.some((evidence) =>
        evidence.attributes.artifacts.includes(roles.handoff?.artifactReference ?? ''),
      ),
    ).toBe(true)
    expect(await Bun.file(join(integrationRoot as string, 'src', 'consumer.ts')).text()).toBe(
      'export const consumed = 42\n',
    )
    expect(await Bun.file(join(repoRoot, 'src', 'consumer.ts')).exists()).toBe(false)
    expect(await checkoutSnapshot(repoRoot)).toEqual(checkoutBefore)
  } finally {
    await server?.shutdown()
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}, 30_000)

function createHandoffRoles(): RoleRunner & {
  invocations: string[]
  handoff: HandoffObservation | null
} {
  const roles = {
    invocations: [] as string[],
    handoff: null as HandoffObservation | null,
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      roles.invocations.push(`${input.responsibility}:${input.workId}`)
      if (input.responsibility === 'planner') return plan(input)
      if (input.responsibility === 'generator' && input.workId === PRODUCE_WORK) {
        await mkdir(join(input.cwd, 'src'), { recursive: true })
        await Bun.write(join(input.cwd, 'src', 'producer.ts'), 'export const produced = 41\n')
        const proof = join(input.context.runtimeScratchDir, 'proof.txt')
        await Bun.write(proof, 'accepted predecessor value: 41\n')
        return success('Produced source plus one immutable handoff proof.', [proof])
      }
      if (input.responsibility === 'reviewer' && input.workId === PRODUCE_WORK) {
        expect(await Bun.file(join(primarySourceRoot(input), 'src', 'producer.ts')).text()).toBe(
          'export const produced = 41\n',
        )
        return success('Accepted the predecessor source independently.')
      }
      if (input.responsibility === 'generator' && input.workId === CONSUME_WORK) {
        roles.handoff = await inspectHandoff(input)
        const value = Number((await Bun.file(roles.handoff.artifactPath).text()).match(/\d+/)?.[0])
        await Bun.write(
          join(input.cwd, 'src', 'consumer.ts'),
          `export const consumed = ${value + 1}\n`,
        )
        return success('Consumed only the staged predecessor proof.')
      }
      if (input.responsibility === 'reviewer' && input.workId === CONSUME_WORK) {
        expect(await Bun.file(join(primarySourceRoot(input), 'src', 'consumer.ts')).text()).toBe(
          'export const consumed = 42\n',
        )
        return success('Accepted the dependent result independently.')
      }
      throw new Error(
        `Unexpected responsibility invocation: ${input.responsibility}/${input.workId}`,
      )
    },
  }
  return roles
}

function primarySourceRoot(input: RoleRunInput) {
  const root = input.context.repoRoots.find((repo) => repo.primary)?.path
  if (!root) throw new Error('Responsibility context has no primary source root')
  return root
}

async function inspectHandoff(input: RoleRunInput): Promise<HandoffObservation> {
  const manifestPath = input.context.artifactManifestFile
  if (!manifestPath) throw new Error('Dependent Work received no Evidence artifact manifest')
  const manifest = (await Bun.file(manifestPath).json()) as {
    version: number
    artifacts: Array<{
      reference: string
      path: string
      evidence: string[]
    }>
  }
  expect(manifest.version).toBe(1)
  expect(manifest.artifacts).toHaveLength(1)
  const artifact = manifest.artifacts[0]
  if (!artifact) throw new Error('Dependent Work received an empty artifact manifest')
  expect(await Bun.file(artifact.path).text()).toBe('accepted predecessor value: 41\n')

  const authorityGoalRoot = join(
    input.context.contextRoot,
    'authority',
    '.hopi',
    'docs',
    'goals',
    input.goalId,
  )
  const predecessor = parseWorkDocument(
    await Bun.file(join(authorityGoalRoot, 'work', `${PRODUCE_WORK}.md`)).text(),
  )
  expect(predecessor.attributes.stage).toBe('done')
  expect(artifact.evidence.toSorted()).toEqual(
    predecessor.attributes.evidenceRefs
      .map((evidenceId) => `.hopi/docs/goals/${input.goalId}/evidence/${evidenceId}.md`)
      .filter((path) => artifact.evidence.includes(path))
      .toSorted(),
  )
  for (const path of predecessor.attributes.evidenceRefs.map((evidenceId) =>
    join(authorityGoalRoot, 'evidence', `${evidenceId}.md`),
  )) {
    expect(await Bun.file(path).exists()).toBe(true)
  }
  return {
    artifactReference: artifact.reference,
    artifactPath: artifact.path,
    evidencePaths: predecessor.attributes.evidenceRefs.map((evidenceId) =>
      join(authorityGoalRoot, 'evidence', `${evidenceId}.md`),
    ),
    manifestPath,
    predecessorStage: predecessor.attributes.stage,
  }
}

async function plan(input: RoleRunInput): Promise<RoleRunResult> {
  const goalRoot = join(input.context.proposalRoot, '.hopi', 'docs', 'goals', input.goalId)
  const authorityRoot = join(
    input.context.contextRoot,
    'authority',
    '.hopi',
    'docs',
    'goals',
    input.goalId,
  )
  const planning = parseWorkDocument(
    await Bun.file(join(authorityRoot, 'work', `${input.workId}.md`)).text(),
  )
  const authorityWorks = await Promise.all(
    (await readdir(join(authorityRoot, 'work')))
      .filter((path) => path.endsWith('.md'))
      .map((path) =>
        Bun.file(join(authorityRoot, 'work', path))
          .text()
          .then(parseWorkDocument),
      ),
  )
  const engineering = authorityWorks.filter((work) => work.attributes.kind === 'engineering')

  if (engineering.length === 0) {
    const workRoot = join(goalRoot, 'work')
    await mkdir(workRoot, { recursive: true })
    await Bun.write(
      join(workRoot, `${PRODUCE_WORK}.md`),
      renderWorkDocument({
        attributes: {
          id: PRODUCE_WORK,
          title: 'Produce accepted proof',
          kind: 'engineering',
          stage: 'generate',
          repos: ['primary'],
          notBefore: null,
          dependsOn: [],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: '## Acceptance Criteria\n\n- Produce source value 41 and one reusable proof artifact.\n',
      }),
    )
    await Bun.write(
      join(workRoot, `${CONSUME_WORK}.md`),
      renderWorkDocument({
        attributes: {
          id: CONSUME_WORK,
          title: 'Consume accepted proof',
          kind: 'engineering',
          stage: 'generate',
          repos: ['primary'],
          notBefore: null,
          dependsOn: [PRODUCE_WORK],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: '## Acceptance Criteria\n\n- Consume the accepted predecessor artifact and export value 42.\n',
      }),
    )
  } else {
    expect(engineering.every((work) => work.attributes.stage === 'done')).toBe(true)
    const attentionId = `A-complete-${input.runId}`
    const attentionPath = join(goalRoot, 'attention', `${attentionId}.md`)
    await mkdir(dirname(attentionPath), { recursive: true })
    await Bun.write(
      attentionPath,
      renderAttentionDocument({
        attributes: {
          id: attentionId,
          target: null,
          createdAt: '2026-07-17T00:00:00.000Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Completion\n\nBoth dependency Works are integrated and verified.\n',
      }),
    )
  }
  return success('Planner published the dependency handoff state.')
}

function success(summary: string, artifacts: string[] = []): RoleRunResult {
  return { result: 'success', summary, artifacts, exitCode: 0 }
}

async function initializeFixtureRepo(repoRoot: string) {
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await mkdir(join(repoRoot, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(repoRoot, 'AGENTS.md'), '# Dependency handoff fixture\n')
  await Bun.write(join(repoRoot, 'src', 'seed.ts'), 'export const seed = true\n')
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
