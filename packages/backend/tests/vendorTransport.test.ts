import { describe, expect, test } from 'bun:test'
import {
  type RoleTransportConfig,
  appendCodexHttpsOnlyConfig,
  resolveConfiguredTransportCommand,
  roleTransportConfigSchema,
} from '../src/agent/vendorTransport'

const bundle = {
  runtimeScratchDir: '/tmp/run/scratch',
  runtimeCacheDir: '/tmp/hopi/cache',
  goalFile: '/tmp/goal.md',
  designFile: '/tmp/design.md',
  contextFile: '/tmp/context.md',
  promptFile: '/tmp/prompt.md',
  outcomeFile: '/tmp/outcome.json',
  canonicalOutcomeFile: '/tmp/outcome.json',
  browserHarnessDir: 'scripts/hopi/browser-harness',
  browserHarnessArtifactDir: '/tmp/worktree/.hopi-runtime/browser-harness',
  canonicalBrowserHarnessArtifactDir: '/tmp/project/.hopi/runtime/browser-harness',
  apiOrigin: 'http://127.0.0.1:3000',
}

const input = {
  goalKey: 'goal-1',
  runId: 'run-1',
  stepId: 'step-1',
  taskRef: 'T-1',
  taskKind: 'engineering' as const,
  role: 'generator' as const,
}

describe('resolveConfiguredTransportCommand', () => {
  test('rejects an OpenCode model without its provider namespace', () => {
    const parsed = roleTransportConfigSchema.safeParse({
      transport: 'opencode',
      cwdMode: 'root',
      model: 'gemini-3.1-pro-preview',
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        'OpenCode model must use provider/model format (for example, openai/gpt-5)',
      )
    }
  })

  test('builds a codex exec command that reads the bundled prompt from stdin', async () => {
    await Bun.write(bundle.promptFile, '# prompt for codex\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'codex',
        binary: '/usr/local/bin/codex',
        cwdMode: 'worktree',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
        model: 'gpt-5-codex',
        reasoningEffort: 'xhigh',
      } satisfies RoleTransportConfig,
      bundle,
      input,
    })

    expect(command).toMatchObject({
      cwdMode: 'worktree',
      outcomeFile: bundle.outcomeFile,
      browserHarnessArtifactDir: bundle.browserHarnessArtifactDir,
      canonicalBrowserHarnessArtifactDir: bundle.canonicalBrowserHarnessArtifactDir,
      stdin: '# prompt for codex\n',
      transcriptFormat: 'codex_jsonl',
    })
    expect(command.cmd).toEqual([
      '/usr/local/bin/codex',
      ...codexHttpsOnlyArgs(),
      '-a',
      'never',
      '-c',
      'model_reasoning_effort="xhigh"',
      '-c',
      'sandbox_workspace_write.network_access=true',
      'exec',
      '--ignore-user-config',
      '--skip-git-repo-check',
      '-s',
      'workspace-write',
      '-m',
      'gpt-5-codex',
      '--json',
      '-',
    ])
  })

  test('passes uploaded image files through codex -i arguments', async () => {
    await Bun.write(bundle.promptFile, '# prompt for codex with images\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'codex',
        binary: '/usr/local/bin/codex',
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      } satisfies RoleTransportConfig,
      bundle: {
        ...bundle,
        imageFiles: ['/tmp/screen-1.png', '/tmp/screen-2.webp'],
      },
      input,
    })

    expect(command.cmd).toEqual([
      '/usr/local/bin/codex',
      ...codexHttpsOnlyArgs(),
      '-a',
      'never',
      '-c',
      'sandbox_workspace_write.network_access=true',
      'exec',
      '--ignore-user-config',
      '--skip-git-repo-check',
      '-s',
      'workspace-write',
      '-i',
      '/tmp/screen-1.png',
      '-i',
      '/tmp/screen-2.webp',
      '--json',
      '-',
    ])
  })

  test('resumes a Codex responsibility session with the current assignment', async () => {
    await Bun.write(bundle.promptFile, '# current generator assignment\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'codex',
        binary: '/usr/local/bin/codex',
        cwdMode: 'worktree',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
        model: 'gpt-5-codex',
      } satisfies RoleTransportConfig,
      bundle,
      input,
      session: { transport: 'codex', sessionId: 'thread-generator' },
    })

    expect(command.cmd).toEqual([
      '/usr/local/bin/codex',
      ...codexHttpsOnlyArgs(),
      '-a',
      'never',
      '-c',
      'sandbox_workspace_write.network_access=true',
      '-s',
      'workspace-write',
      '-m',
      'gpt-5-codex',
      'exec',
      'resume',
      '--ignore-user-config',
      '--skip-git-repo-check',
      '--json',
      'thread-generator',
      '-',
    ])
    expect(command.sessionTransport).toBe('codex')
    expect(command.stdin).toContain('Continue the same generator responsibility for Work T-1')
    expect(command.stdin).toContain('# current generator assignment')
  })

  test('makes Claude image directories accessible to the responsibility', async () => {
    await Bun.write(bundle.promptFile, '# prompt for claude with images\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'claude',
        cwdMode: 'worktree',
        permissionMode: 'dontAsk',
      } satisfies RoleTransportConfig,
      bundle: { ...bundle, imageFiles: ['/tmp/reference.png'] },
      input,
    })

    expect(command.cmd).toContain('--add-dir')
    expect(command.cmd).toContain('/tmp')
  })

  test('makes read-only Repo roots visible to Claude without granting write access', async () => {
    await Bun.write(bundle.promptFile, '# prompt for read-only repos\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'claude',
        cwdMode: 'worktree',
        permissionMode: 'dontAsk',
      } satisfies RoleTransportConfig,
      bundle: {
        ...bundle,
        extraReadableRoots: ['/tmp/integration'],
        extraWritableRoots: ['/tmp/run'],
      },
      input: { ...input, role: 'reviewer' },
    })

    expect(command.cmd).toContain('/tmp/integration')
    expect(command.cmd).toContain('/tmp/run')
    expect(await Bun.file('/tmp/run/scratch/claude-settings.json').json()).toMatchObject({
      sandbox: { filesystem: { allowWrite: ['/tmp/run'] } },
    })
  })

  test('does not turn Codex read-only Repo roots into writable add-dir roots', async () => {
    await Bun.write(bundle.promptFile, '# prompt for read-only repos\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'codex',
        cwdMode: 'worktree',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      } satisfies RoleTransportConfig,
      bundle: {
        ...bundle,
        extraReadableRoots: ['/tmp/integration'],
        extraWritableRoots: ['/tmp/run'],
      },
      input: { ...input, role: 'reviewer' },
    })

    expect(command.cmd).toContain('/tmp/run')
    expect(command.cmd).not.toContain('/tmp/integration')
  })

  test('passes extra writable roots through codex --add-dir arguments', async () => {
    await Bun.write(bundle.promptFile, '# prompt for codex with writable roots\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'codex',
        binary: '/usr/local/bin/codex',
        cwdMode: 'worktree',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      } satisfies RoleTransportConfig,
      bundle: {
        ...bundle,
        extraWritableRoots: ['/tmp/project/.hopi/docs/goals/goal-1'],
      },
      input: {
        ...input,
        role: 'planner',
      },
    })

    expect(command.cmd).toEqual([
      '/usr/local/bin/codex',
      ...codexHttpsOnlyArgs(),
      '-a',
      'never',
      '-c',
      'sandbox_workspace_write.network_access=true',
      'exec',
      '--ignore-user-config',
      '--skip-git-repo-check',
      '-s',
      'workspace-write',
      '--add-dir',
      '/tmp/project/.hopi/docs/goals/goal-1',
      '--json',
      '-',
    ])
  })

  test('grants workspace-write Engineering Runs network access', async () => {
    for (const role of ['generator', 'reviewer']) {
      await Bun.write(bundle.promptFile, `# prompt for ${role}\n`)

      const command = await resolveConfiguredTransportCommand({
        config: {
          transport: 'codex',
          binary: '/usr/local/bin/codex',
          cwdMode: 'worktree',
          sandbox: 'workspace-write',
          approvalPolicy: 'never',
        } satisfies RoleTransportConfig,
        bundle,
        input: { ...input, role },
      })

      expect(command.cmd).toEqual([
        '/usr/local/bin/codex',
        ...codexHttpsOnlyArgs(),
        '-a',
        'never',
        '-c',
        'sandbox_workspace_write.network_access=true',
        'exec',
        '--ignore-user-config',
        '--skip-git-repo-check',
        '-s',
        'workspace-write',
        '--json',
        '-',
      ])
    }
  })

  test('builds a claude print command that reads the bundled prompt from stdin', async () => {
    await Bun.write(bundle.promptFile, '# prompt for claude\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'claude',
        binary: '/usr/local/bin/claude',
        cwdMode: 'worktree',
        permissionMode: 'dontAsk',
        model: 'sonnet',
      } satisfies RoleTransportConfig,
      bundle,
      input,
    })

    expect(command).toMatchObject({
      cwdMode: 'worktree',
      outcomeFile: bundle.outcomeFile,
      browserHarnessArtifactDir: bundle.browserHarnessArtifactDir,
      canonicalBrowserHarnessArtifactDir: bundle.canonicalBrowserHarnessArtifactDir,
      stdin: '# prompt for claude\n',
      transcriptFormat: 'claude_stream_json',
    })
    expect(command.cmd).toEqual([
      '/usr/local/bin/claude',
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--settings',
      '/tmp/run/scratch/claude-settings.json',
      '--setting-sources',
      '',
      '--permission-mode',
      'dontAsk',
      '--model',
      'sonnet',
    ])
    expect(await Bun.file('/tmp/run/scratch/claude-settings.json').json()).toEqual({
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        filesystem: { allowWrite: [] },
      },
    })
  })

  test('resumes a Claude responsibility session', async () => {
    await Bun.write(bundle.promptFile, '# current reviewer assignment\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'claude',
        binary: '/usr/local/bin/claude',
        cwdMode: 'worktree',
        permissionMode: 'dontAsk',
      } satisfies RoleTransportConfig,
      bundle,
      input: { ...input, role: 'reviewer' },
      session: { transport: 'claude', sessionId: 'claude-reviewer' },
    })

    expect(command.cmd).toContain('--resume')
    expect(command.cmd).toContain('claude-reviewer')
    expect(command.sessionTransport).toBe('claude')
    expect(command.stdin).toContain('# current reviewer assignment')
  })

  test('builds an opencode run command that reads the prompt from stdin', async () => {
    await Bun.write(bundle.promptFile, '# prompt for opencode\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'opencode',
        binary: '/usr/local/bin/opencode',
        cwdMode: 'root',
        model: 'openai/gpt-5',
        agent: 'builder',
        variant: 'high',
      } satisfies RoleTransportConfig,
      bundle,
      input,
    })

    expect(command).toMatchObject({
      cwdMode: 'root',
      outcomeFile: bundle.outcomeFile,
      browserHarnessArtifactDir: bundle.browserHarnessArtifactDir,
      canonicalBrowserHarnessArtifactDir: bundle.canonicalBrowserHarnessArtifactDir,
      transcriptFormat: 'opencode_json',
      stdin: '# prompt for opencode\n',
    })
    expect(command.cmd).toEqual([
      '/usr/local/bin/opencode',
      'run',
      '--format',
      'json',
      '--model',
      'openai/gpt-5',
      '--agent',
      'builder',
      '--variant',
      'high',
    ])
  })

  test('passes OpenCode image inputs as file attachments', async () => {
    await Bun.write(bundle.promptFile, '# prompt for opencode with images\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'opencode',
        cwdMode: 'worktree',
      } satisfies RoleTransportConfig,
      bundle: { ...bundle, imageFiles: ['/tmp/reference.png'] },
      input,
    })

    expect(command.cmd).toEqual([
      'opencode',
      'run',
      '--format',
      'json',
      '--file',
      '/tmp/reference.png',
    ])
    expect(command.stdin).toBe('# prompt for opencode with images\n')
  })

  test('resumes an OpenCode responsibility session', async () => {
    await Bun.write(bundle.promptFile, '# current planner assignment\n')

    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'opencode',
        cwdMode: 'root',
      } satisfies RoleTransportConfig,
      bundle,
      input: { ...input, role: 'planner' },
      session: { transport: 'opencode', sessionId: 'opencode-planner' },
    })

    expect(command.cmd).toEqual([
      'opencode',
      'run',
      '--format',
      'json',
      '--session',
      'opencode-planner',
    ])
    expect(command.sessionTransport).toBe('opencode')
    expect(command.stdin).toContain('# current planner assignment')
  })

  test('keeps the raw process transport path unchanged', async () => {
    const command = await resolveConfiguredTransportCommand({
      config: {
        transport: 'process',
        cmd: ['bun', '-e', 'console.log("ok")'],
        cwdMode: 'root',
        baseRef: 'main',
      } satisfies RoleTransportConfig,
      bundle,
      input,
    })

    expect(command).toEqual({
      cmd: ['bun', '-e', 'console.log("ok")'],
      cwdMode: 'root',
      baseRef: 'main',
      outcomeFile: bundle.outcomeFile,
      canonicalOutcomeFile: bundle.canonicalOutcomeFile,
      browserHarnessArtifactDir: bundle.browserHarnessArtifactDir,
      canonicalBrowserHarnessArtifactDir: bundle.canonicalBrowserHarnessArtifactDir,
      env: {
        HOPI_RUN_SCRATCH: bundle.runtimeScratchDir,
        HOPI_CACHE_DIR: bundle.runtimeCacheDir,
        HOPI_CONTEXT_FILE: bundle.contextFile,
        HOPI_OUTCOME_FILE: bundle.outcomeFile,
        HOPI_GOAL_FILE: bundle.goalFile,
        HOPI_DESIGN_FILE: bundle.designFile,
        HOPI_PROMPT_FILE: bundle.promptFile,
        HOPI_BROWSER_HARNESS_DIR: bundle.browserHarnessDir,
        HOPI_BROWSER_HARNESS_ARTIFACT_DIR: bundle.browserHarnessArtifactDir,
        HOPI_API_ORIGIN: bundle.apiOrigin,
        HOPI_GOAL_KEY: input.goalKey,
        HOPI_GOAL_ID: input.goalKey,
        HOPI_WORK_ID: input.taskRef,
        HOPI_TASK_REF: input.taskRef,
        HOPI_ROLE: input.role,
        HOPI_RUN_ID: input.runId,
        HOPI_STEP_ID: input.stepId,
      },
    })
  })
})

function codexHttpsOnlyArgs() {
  const command: string[] = []
  appendCodexHttpsOnlyConfig(command)
  return command
}
