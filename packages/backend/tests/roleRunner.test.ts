import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ConfiguredRoleRunner, roleSessionCompatibilityKey } from '../src/agent/RoleRunner'
import type { AgentRuntimeEvent } from '../src/agent/runtimeEvents'
import type { VendorSession } from '../src/agent/vendorAssistantOutput'
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
    const executions: string[] = []
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'xhigh',
        binary,
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      }),
    })

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot), {
      onExecution: (execution) => {
        executions.push(
          `${execution.transport}:${execution.model}:${execution.reasoningEffort ?? 'none'}`,
        )
      },
      onSession: (session) => {
        sessions.push(`${session.transport}:${session.sessionId}`)
      },
    })

    expect(result).toMatchObject({ result: 'success', summary: 'continued' })
    expect(executions).toEqual(['codex:gpt-5.6-sol:xhigh'])
    expect(sessions).toEqual(['codex:thread-generator'])
  })

  test('persists a schema-constrained Claude outcome without a model-authored file write', async () => {
    const fixture = await createFixture()
    const outcome = { result: 'success', summary: 'structured completion', artifacts: [] }
    const binary = await fakeClaude(
      fixture.root,
      `console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-structured"}))
      console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-structured",result:JSON.stringify(${JSON.stringify(outcome)}),structured_output:${JSON.stringify(outcome)}}))`,
    )
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'claude',
        binary,
        cwdMode: 'root',
        permissionMode: 'dontAsk',
      }),
    })

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot))

    expect(result).toMatchObject({ result: 'success', summary: 'structured completion' })
    expect(await Bun.file(fixture.context.resultFile).json()).toEqual(outcome)
  })

  test('persists a schema-constrained Codex outcome from its adapter-owned output file', async () => {
    const fixture = await createFixture()
    const binary = await fakeCodex(
      fixture.root,
      `console.log(JSON.stringify({type:"thread.started",thread_id:"codex-structured"}))
      const outputIndex = Bun.argv.indexOf("--output-last-message")
      if (outputIndex < 0) throw new Error("missing structured output path")
      await Bun.write(Bun.argv[outputIndex + 1], JSON.stringify({result:"success",summary:"codex completion",artifacts:[]}))`,
    )
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'codex',
        binary,
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      }),
    })

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot))

    expect(result).toMatchObject({ result: 'success', summary: 'codex completion' })
    expect(await Bun.file(fixture.context.resultFile).json()).toEqual({
      result: 'success',
      summary: 'codex completion',
      artifacts: [],
    })
  })

  test('persists an exact OpenCode terminal outcome without a model-authored file write', async () => {
    const fixture = await createFixture()
    const outcome = { result: 'success', summary: 'opencode completion', artifacts: [] }
    const binary = await fakeOpenCode(
      fixture.root,
      `console.log(JSON.stringify({type:"text",sessionID:"opencode-structured",part:{messageID:"message-1",type:"text",text:JSON.stringify(${JSON.stringify(outcome)})}}))`,
    )
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'opencode',
        binary,
        cwdMode: 'root',
      }),
    })

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot))

    expect(result).toMatchObject({ result: 'success', summary: 'opencode completion' })
    expect(await Bun.file(fixture.context.resultFile).json()).toEqual(outcome)
  })

  test('recovers a missing Plan Mode outcome once in the same Run and Session', async () => {
    const fixture = await createFixture()
    const binary = await fakeClaude(
      fixture.root,
      `const resumed = Bun.argv.includes("--resume")
      const prompt = await Bun.stdin.text()
      console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-plan"}))
      if (resumed) {
        await Bun.write(process.env.HOPI_RUN_SCRATCH + "/recovery-prompt.txt", prompt)
        const outcome = {result:"success",summary:"completed without a new Attempt",artifacts:[]}
        console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-plan",result:JSON.stringify(outcome),structured_output:outcome}))
      } else {
        console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"plan-1",name:"EnterPlanMode",input:{}}]}}))
        console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-plan",result:"Please approve the plan."}))
      }`,
    )
    const messages: string[] = []
    let invalidations = 0
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'claude',
        binary,
        cwdMode: 'root',
        permissionMode: 'dontAsk',
      }),
    })

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot), {
      onEvent: (event) => {
        if (event.kind === 'message') messages.push(event.content)
      },
      onSessionInvalid: () => {
        invalidations += 1
      },
    })

    expect(result).toMatchObject({
      result: 'success',
      summary: 'completed without a new Attempt',
    })
    expect(invalidations).toBe(0)
    expect(messages).toContain(
      'The non-interactive responsibility entered vendor Plan Mode and could not obtain operator approval. Continuing the same Session once inside this Run to complete the responsibility outcome.',
    )
    expect(await Bun.file(join(fixture.runtimeScratchDir, 'recovery-prompt.txt')).text()).toContain(
      'do not repeat Repo preparation',
    )
  })

  test('invalidates a Session that omits its outcome again during same-Run recovery', async () => {
    const fixture = await createFixture()
    const binary = await fakeClaude(
      fixture.root,
      `console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-stuck"}))
      console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"plan-1",name:"EnterPlanMode",input:{}}]}}))
      console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-stuck",result:"Still waiting for approval."}))`,
    )
    let invalidations = 0
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'claude',
        binary,
        cwdMode: 'root',
        permissionMode: 'dontAsk',
      }),
    })

    const result = await runner.run(fixture.input('planner', fixture.proposalRoot), {
      onSessionInvalid: () => {
        invalidations += 1
      },
    })

    expect(result).toMatchObject({ result: 'fail', failureKind: 'operational' })
    expect(result.summary).toContain('entered vendor Plan Mode')
    expect(result.summary).toContain('Same-Run outcome recovery also failed')
    expect(invalidations).toBe(1)
  })

  test('keeps Claude task identity across resumed responsibility Attempts', async () => {
    const fixture = await createFixture()
    const binary = await fakeClaude(
      fixture.root,
      `const resumed = Bun.argv.includes("--resume")
      console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-session"}))
      if (resumed) {
        console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"call-update",name:"TaskUpdate",input:{taskId:"1",status:"completed"}}]}}))
        console.log(JSON.stringify({type:"user",message:{content:[{type:"tool_result",tool_use_id:"call-update",content:"Updated task #1 status"}]},tool_use_result:{success:true,taskId:"1"}}))
      } else {
        console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"call-create",name:"TaskCreate",input:{subject:"Implement the projection"}}]}}))
        console.log(JSON.stringify({type:"user",message:{content:[{type:"tool_result",tool_use_id:"call-create",content:"Task #1 created successfully"}]},tool_use_result:{task:{id:"1",subject:"Implement the projection",status:"pending"}}}))
      }
      console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-session",result:"done"}))
      await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"continued",artifacts:[]}))`,
    )
    const config = {
      transport: 'claude',
      binary,
      cwdMode: 'root',
      permissionMode: 'dontAsk',
    } as const
    const runner = new ConfiguredRoleRunner({ resolveConfig: () => config })
    const firstEvents: AgentRuntimeEvent[] = []
    const secondEvents: AgentRuntimeEvent[] = []
    let session: VendorSession | null = null

    await runner.run(fixture.input('generator', fixture.repoRoot), {
      onEvent: (event) => {
        firstEvents.push(event)
      },
      onSession: (nextSession) => {
        session = nextSession
      },
    })
    expect(session).not.toBeNull()
    await runner.run(
      {
        ...fixture.input('generator', fixture.repoRoot),
        session,
      },
      {
        onEvent: (event) => {
          secondEvents.push(event)
        },
      },
    )

    expect(firstEvents).toContainEqual(
      expect.objectContaining({
        kind: 'plan',
        items: [{ text: 'Implement the projection', completed: false }],
      }),
    )
    expect(secondEvents).toContainEqual(
      expect.objectContaining({
        kind: 'plan',
        status: 'completed',
        items: [{ text: 'Implement the projection', completed: true }],
      }),
    )
    expect([...firstEvents, ...secondEvents]).not.toContainEqual(
      expect.objectContaining({ entryKind: 'tool_call', toolName: 'TaskUpdate' }),
    )
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
    const config = {
      transport: 'codex',
      binary,
      cwdMode: 'root',
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
    } as const
    const runner = new ConfiguredRoleRunner({ resolveConfig: () => config })

    const result = await runner.run(
      {
        ...fixture.input('planner', fixture.proposalRoot),
        session: {
          transport: 'codex',
          sessionId: 'thread-missing',
          compatibilityKey: roleSessionCompatibilityKey(config) ?? undefined,
        },
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
    const config = {
      transport: 'codex',
      binary,
      cwdMode: 'root',
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
    } as const
    const runner = new ConfiguredRoleRunner({ resolveConfig: () => config })

    const result = await runner.run(
      {
        ...fixture.input('planner', fixture.proposalRoot),
        session: {
          transport: 'codex',
          sessionId: 'thread-valid',
          compatibilityKey: roleSessionCompatibilityKey(config) ?? undefined,
        },
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

  test('does not resume a legacy Session without the current execution compatibility identity', async () => {
    const fixture = await createFixture()
    const binary = await fakeCodex(
      fixture.root,
      `const resumed = Bun.argv.includes("resume")
      await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:resumed ? "unexpected resume" : "fresh boundary",artifacts:[]}))`,
    )
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'codex',
        binary,
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      }),
    })
    let invalidations = 0

    const result = await runner.run(
      {
        ...fixture.input('planner', fixture.proposalRoot),
        session: { transport: 'codex', sessionId: 'legacy-thread' },
      },
      {
        onSessionInvalid: () => {
          invalidations += 1
        },
      },
    )

    expect(result).toMatchObject({ result: 'success', summary: 'fresh boundary' })
    expect(invalidations).toBe(1)
  })

  test('rejects success and invalidates the Session when tool infrastructure stays unavailable', async () => {
    const fixture = await createFixture()
    const binary = await fakeClaude(
      fixture.root,
      `console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-broken"}))
      console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"bash-1",name:"Bash",input:{command:"bun test"}}]}}))
      console.log(JSON.stringify({type:"user",message:{content:[{type:"tool_result",tool_use_id:"bash-1",is_error:true,content:"Sandbox is required but failed to initialize: Failed to create bridge sockets after 5 attempts."}]},tool_use_result:{success:false}}))
      console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-broken",result:"done"}))
      await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"implemented",artifacts:[]}))`,
    )
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'claude',
        binary,
        cwdMode: 'root',
        permissionMode: 'dontAsk',
      }),
    })
    let invalidations = 0

    const result = await runner.run(fixture.input('generator', fixture.repoRoot), {
      onSessionInvalid: () => {
        invalidations += 1
      },
    })

    expect(result).toMatchObject({ result: 'fail', failureKind: 'operational' })
    expect(result.summary).toContain('required execution capability remained unavailable')
    expect(invalidations).toBe(1)
  })

  test('rejects interactive Generator success without a completed execution verification', async () => {
    const fixture = await createFixture()
    const binary = await fakeClaude(
      fixture.root,
      `console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-unverified"}))
      console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-unverified",result:"done"}))
      await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"implemented by inspection",artifacts:[]}))`,
    )
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'claude',
        binary,
        cwdMode: 'root',
        permissionMode: 'dontAsk',
      }),
    })
    let invalidations = 0

    const result = await runner.run(fixture.input('generator', fixture.repoRoot), {
      onSessionInvalid: () => {
        invalidations += 1
      },
    })

    expect(result).toMatchObject({ result: 'fail', failureKind: 'operational' })
    expect(result.summary).toContain('without completing an execution verification')
    expect(invalidations).toBe(1)
  })

  test('keeps success when the same execution capability recovers in the invocation', async () => {
    const fixture = await createFixture()
    const binary = await fakeClaude(
      fixture.root,
      `console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"bash-1",name:"Bash",input:{command:"bun test"}}]}}))
      console.log(JSON.stringify({type:"user",message:{content:[{type:"tool_result",tool_use_id:"bash-1",is_error:true,content:"Sandbox is required but failed to initialize."}]},tool_use_result:{success:false}}))
      console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"bash-2",name:"Bash",input:{command:"bun test"}}]}}))
      console.log(JSON.stringify({type:"user",message:{content:[{type:"tool_result",tool_use_id:"bash-2",content:"1 pass"}]},tool_use_result:{success:true}}))
      console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-recovered",result:"done"}))
      await Bun.write(process.env.HOPI_OUTCOME_FILE, JSON.stringify({result:"success",summary:"verified",artifacts:[]}))`,
    )
    const runner = new ConfiguredRoleRunner({
      resolveConfig: () => ({
        transport: 'claude',
        binary,
        cwdMode: 'root',
        permissionMode: 'dontAsk',
      }),
    })
    let invalidations = 0

    const result = await runner.run(fixture.input('generator', fixture.repoRoot), {
      onSessionInvalid: () => {
        invalidations += 1
      },
    })

    expect(result).toMatchObject({ result: 'success', summary: 'verified' })
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
    context,
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

async function fakeClaude(root: string, code: string) {
  const path = join(root, `fake-claude-${crypto.randomUUID()}`)
  await Bun.write(path, `#!/usr/bin/env bun\n${code}\n`)
  await chmod(path, 0o755)
  return path
}

async function fakeOpenCode(root: string, code: string) {
  const path = join(root, `fake-opencode-${crypto.randomUUID()}`)
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
