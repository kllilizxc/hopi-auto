import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ConfiguredRoleRunner } from '../src/agent/RoleRunner'
import type { AgentRuntimeEvent } from '../src/agent/runtimeEvents'
import type { RoleContextBundle } from '../src/runtime/roleContextStager'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('ConfiguredRoleRunner', () => {
  test('accepts only the minimal valid Planner result', async () => {
    const fixture = await createFixture()
    const runner = processRunner(
      'await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"planned",artifacts:[]}))',
    )

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot))

    expect(result).toMatchObject({ result: 'success', summary: 'planned', exitCode: 0 })
  })

  test('preserves raw stdout and stderr before transcript normalization', async () => {
    const fixture = await createFixture()
    const runner = processRunner(
      'console.log("raw-output-" + "x".repeat(600)); console.error("raw-error-detail"); await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"planned",artifacts:[]}))',
    )

    await runner.run(fixture.input('planner', fixture.proposalRoot))

    const transcript = await Bun.file(join(fixture.runRoot, 'transcript.log')).text()
    expect(transcript).toContain(`stdout: raw-output-${'x'.repeat(600)}`)
    expect(transcript).toContain('stderr: raw-error-detail')
  })

  test('keeps only a bounded stderr tail in memory while preserving the raw transcript', async () => {
    const fixture = await createFixture()
    const runner = processRunner(
      'for(let index=0;index<250;index+=1) console.error("stderr-"+String(index).padStart(3,"0")); process.exit(7)',
    )

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot))
    const transcript = await Bun.file(join(fixture.runRoot, 'transcript.log')).text()

    expect(result).toMatchObject({
      result: 'fail',
      summary: 'process exited with code 7: stderr-249',
      exitCode: 7,
    })
    expect(transcript).toContain('stderr: stderr-000')
    expect(transcript).toContain('stderr: stderr-249')
  })

  test('provides Run-scoped temp and Home-scoped cache environments', async () => {
    const fixture = await createFixture()
    const runner = processRunner(
      'const scratch=process.env.HOPI_RUN_SCRATCH; const cache=process.env.HOPI_CACHE_DIR; if(!scratch || !cache || process.env.BUN_TMPDIR!==scratch+"/tmp" || process.env.XDG_CACHE_HOME!==cache) throw new Error("missing runtime storage"); await Bun.write(process.env.BUN_TMPDIR+"/probe", "ok"); await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"scratch ready",artifacts:[]}))',
    )

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot))

    expect(result).toMatchObject({ result: 'success', summary: 'scratch ready' })
    expect(await Bun.file(join(fixture.runtimeScratchDir, 'tmp', 'probe')).text()).toBe('ok')
  })

  test('normalizes an invalid responsibility/result combination to fail', async () => {
    const fixture = await createFixture()
    const runner = processRunner(
      'await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"reject",summary:"no",artifacts:[]}))',
    )

    const result = await runner.run(fixture.input('generator', fixture.repoRoot))

    expect(result.result).toBe('fail')
    expect(result.summary).toContain('generator cannot return reject')
    expect(result.failureKind).toBe('operational')
  })

  test('rejects a Reviewer that edits the task worktree', async () => {
    const fixture = await createFixture()
    const runner = processRunner(
      'await Bun.write("source.ts", "changed\\n"); await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"reviewed",artifacts:[]}))',
    )

    const result = await runner.run(fixture.input('reviewer', fixture.repoRoot))

    expect(result.result).toBe('fail')
    expect(result.summary).toContain('reviewer modified')
    expect(result.failureKind).toBe('operational')
  })

  test('rejects a Reviewer that edits any Repo in its workspace', async () => {
    const fixture = await createFixture()
    const apiRoot = join(dirname(fixture.repoRoot), 'api')
    await mkdir(apiRoot, { recursive: true })
    await Bun.write(join(apiRoot, 'api.ts'), 'original\n')
    await git(apiRoot, ['init', '-b', 'main'])
    await git(apiRoot, ['config', 'user.email', 'hopi@example.test'])
    await git(apiRoot, ['config', 'user.name', 'HOPI Test'])
    await git(apiRoot, ['add', '.'])
    await git(apiRoot, ['commit', '-m', 'initial'])
    const runner = processRunner(
      `await Bun.write(${JSON.stringify(join(apiRoot, 'api.ts'))}, "changed\\n"); await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"reviewed",artifacts:[]}))`,
    )

    const result = await runner.run({
      ...fixture.input('reviewer', fixture.repoRoot),
      sourceRoots: [fixture.repoRoot, apiRoot],
    })

    expect(result.result).toBe('fail')
    expect(result.summary).toContain('reviewer modified a task worktree')
  })

  test('rejects workflow document writes from an Engineering pass', async () => {
    const fixture = await createFixture()
    const runner = processRunner(
      'await Bun.write(".hopi/forbidden.md", "bad\\n"); await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"generated",artifacts:[]}))',
    )

    const result = await runner.run(fixture.input('generator', fixture.repoRoot))

    expect(result.result).toBe('fail')
    expect(result.summary).toContain('canonical .hopi')
  })

  test('terminates child processes left behind by a responsibility Run', async () => {
    const fixture = await createFixture()
    const pidFile = join(fixture.runRoot, 'child.pid')
    const runner = processRunner(
      `const child = Bun.spawn(["bun", "-e", "setInterval(() => {}, 1000)"], {stdout:"ignore", stderr:"ignore"}); child.unref(); await Bun.write(${JSON.stringify(pidFile)}, String(child.pid)); await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"planned",artifacts:[]}))`,
    )

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot))
    const pid = Number(await Bun.file(pidFile).text())

    expect(result.result).toBe('success')
    expect(processExists(pid)).toBe(false)
  })

  test('interrupts the responsibility process group through its Run signal', async () => {
    const fixture = await createFixture()
    const controller = new AbortController()
    const runner = processRunner('setInterval(() => {}, 1000)')
    const running = runner.run({
      ...fixture.input('planner', fixture.proposalRoot),
      signal: controller.signal,
    })
    await Bun.sleep(50)

    controller.abort()
    const result = await running

    expect(result).toMatchObject({ result: 'fail' })
    expect(result.summary).toContain('interrupted')
  })

  test('classifies a nonzero transport exit as operational rather than Work evidence', async () => {
    const fixture = await createFixture()
    const runner = processRunner('console.error("provider quota exhausted"); process.exit(1)')

    const result = await runner.run(fixture.input('reviewer', fixture.repoRoot))

    expect(result).toMatchObject({
      result: 'fail',
      exitCode: 1,
      failureKind: 'operational',
    })
    expect(result.summary).toContain('provider quota exhausted')
  })

  test('retains a Codex model refresh timeout without using it as the failure', async () => {
    const fixture = await createFixture()
    const warning =
      '2026-07-17T16:43:47.149889Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit'
    const binary = await fakeCodex(
      fixture.root,
      `console.error("provider connection failed"); console.error(${JSON.stringify(warning)}); process.exit(1)`,
    )
    const events: AgentRuntimeEvent[] = []
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'codex',
        binary,
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      }),
    })

    const result = await runner.run(fixture.input('generator', fixture.repoRoot), {
      onEvent: (event) => {
        events.push(event)
      },
    })

    expect(result).toMatchObject({ result: 'fail', failureKind: 'operational' })
    expect(result.summary).toContain('provider connection failed')
    expect(result.summary).not.toContain('failed to refresh available models')
    expect(events).not.toContainEqual(expect.objectContaining({ summary: warning }))
    expect(await Bun.file(join(fixture.runRoot, 'transcript.log')).text()).toContain(warning)
  })

  test('captures a built-in vendor session as soon as the responsibility reports it', async () => {
    const fixture = await createFixture()
    const binary = await fakeCodex(
      fixture.root,
      'console.log(JSON.stringify({type:"thread.started",thread_id:"thread-generator"})); await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"continued",artifacts:[]}))',
    )
    const sessions: string[] = []
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'codex',
        binary,
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      }),
    })

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot), {
      onSession: (session) => {
        sessions.push(`${session.transport}:${session.sessionId}`)
      },
    })

    expect(result).toMatchObject({ result: 'success', summary: 'continued' })
    expect(sessions).toEqual(['codex:thread-generator'])
  })

  test('rebuilds an explicitly invalid saved session once inside the same Attempt', async () => {
    const fixture = await createFixture()
    const binary = await fakeCodex(
      fixture.root,
      'if(Bun.argv.includes("resume")){console.error("saved thread not found");process.exit(1)} console.log(JSON.stringify({type:"thread.started",thread_id:"thread-rebuilt"})); await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"rebuilt",artifacts:[]}))',
    )
    const sessions: string[] = []
    const messages: string[] = []
    let invalidations = 0
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'codex',
        binary,
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      }),
    })

    const result = await runner.run(
      {
        ...fixture.input('planner', fixture.proposalRoot),
        session: { transport: 'codex', sessionId: 'thread-missing' },
      },
      {
        onEvent: (event) => {
          if (event.kind === 'message') messages.push(event.content)
        },
        onSession: (session) => {
          sessions.push(session.sessionId)
        },
        onSessionInvalid: () => {
          invalidations += 1
        },
      },
    )

    expect(result).toMatchObject({ result: 'success', summary: 'rebuilt' })
    expect(invalidations).toBe(1)
    expect(sessions).toEqual(['thread-rebuilt'])
    expect(messages).toContain(
      'The saved responsibility Session could not continue; rebuilding it once from the current assignment.',
    )
    expect(await Bun.file(join(fixture.runRoot, 'transcript.log')).text()).toContain(
      'saved thread not found',
    )
  })

  test('does not treat resumed model or tool content as a session failure', async () => {
    const fixture = await createFixture()
    const binary = await fakeCodex(
      fixture.root,
      `if(Bun.argv.includes("resume")) {
        console.log(JSON.stringify({type:"item.completed",item:{type:"command_execution",aggregated_output:"No later than the cutoff and before the first trading session. Session alignment reports missing bars."}}))
        await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"resumed",artifacts:[]}))
      } else {
        await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"unexpected rebuild",artifacts:[]}))
      }`,
    )
    let invalidations = 0
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'codex',
        binary,
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      }),
    })

    const result = await runner.run(
      {
        ...fixture.input('planner', fixture.proposalRoot),
        session: { transport: 'codex', sessionId: 'thread-valid' },
      },
      {
        onSessionInvalid: () => {
          invalidations += 1
        },
      },
    )

    expect(result).toMatchObject({ result: 'success', summary: 'resumed' })
    expect(invalidations).toBe(0)
  })
})

function processRunner(code: string) {
  return new ConfiguredRoleRunner({
    resolveConfig: () => ({
      transport: 'process',
      cwdMode: 'worktree',
      cmd: ['bun', '-e', code],
    }),
  })
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-role-runner-'))
  temporaryRoots.push(root)
  const repoRoot = join(root, 'repo')
  const runRoot = join(root, 'run')
  const proposalRoot = join(runRoot, 'proposal')
  const runtimeScratchDir = join(runRoot, 'scratch')
  const runtimeCacheDir = join(root, 'cache')
  await mkdir(proposalRoot, { recursive: true })
  await mkdir(join(repoRoot, '.hopi'), { recursive: true })
  await Bun.write(join(repoRoot, 'source.ts'), 'original\n')
  await Bun.write(join(repoRoot, '.hopi', 'canonical.md'), 'authority\n')
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const resultFile = join(runRoot, 'result.json')
  const context: RoleContextBundle = {
    runRoot,
    runtimeScratchDir,
    runtimeCacheDir,
    contextRoot: join(runRoot, 'context'),
    proposalRoot,
    resultFile,
    releaseHead: 'a'.repeat(40),
    goalHash: 'a'.repeat(64),
    workHash: 'b'.repeat(64),
    authorityFiles: [],
    guardFiles: {},
    guardPrefixes: [],
    repoRoots: [{ repoId: 'primary', path: repoRoot, primary: true }],
    reposFile: join(runRoot, 'repos.json'),
    goalFile: join(runRoot, 'goal.md'),
    designFile: join(runRoot, 'design.md'),
    contextFile: join(runRoot, 'context.md'),
    promptFile: join(runRoot, 'prompt.md'),
    outcomeFile: resultFile,
    canonicalOutcomeFile: resultFile,
    browserHarnessDir: 'scripts/hopi/browser-harness',
    browserHarnessArtifactDir: join(runRoot, 'browser-harness'),
    canonicalBrowserHarnessArtifactDir: join(runRoot, 'browser-harness'),
  }
  await Bun.write(context.contextFile, '# Context\n')
  await Bun.write(context.promptFile, '# Prompt\n')

  return {
    root,
    repoRoot,
    runRoot,
    runtimeScratchDir,
    proposalRoot,
    input(responsibility: 'planner' | 'generator' | 'reviewer', cwd: string) {
      return {
        projectId: 'project-1',
        goalId: 'goal-1',
        workId: 'work-1',
        runId: crypto.randomUUID(),
        responsibility,
        cwd,
        context,
      } as const
    },
  }
}

async function fakeCodex(root: string, code: string) {
  const path = join(root, `fake-codex-${crypto.randomUUID()}`)
  await Bun.write(path, `#!/usr/bin/env bun\n${code}\n`)
  await chmod(path, 0o755)
  return path
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

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ESRCH'
    ) {
      return false
    }
    throw error
  }
}
