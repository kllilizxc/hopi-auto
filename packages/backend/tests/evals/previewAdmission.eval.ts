import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readAgentAdapterConfig,
  resolveAssistantTransportConfig,
} from '../../src/agent/adapterConfig'
import {
  type AssistantModelInput,
  type AssistantModelRunner,
  createConfiguredAssistantModelRunner,
} from '../../src/assistant/workspaceAssistant'
import { createServer } from '../../src/mvpServer'
import { agentAdapterConfigPath } from '../../src/storage/assistantRuntimePaths'

interface DecisionOperation {
  tool: string
  arguments: Record<string, unknown>
  reason: string
}

interface PreviewAdmissionDecision {
  diagnosis: string
  operations: DecisionOperation[]
  executionPlan: string[]
  operatorQuestion: string | null
  acceptance: string[]
}

const projectId = 'P-preview-admission-probe'
const root = await mkdtemp(join(tmpdir(), 'hopi-preview-admission-eval-'))
const homeRoot = join(root, 'home')
const repoRoot = join(root, 'repo')
const modelRoot = join(root, 'model')
let server: ReturnType<typeof createServer> | null = null

try {
  await createRepo(repoRoot)
  const captured = deferred<AssistantModelInput>()
  const captureRunner: AssistantModelRunner = {
    async run(input) {
      captured.resolve(input)
      return {
        reply: '',
        session: { transport: 'codex', sessionId: 'preview-admission-capture' },
      }
    },
  }
  server = createServer({ rootDir: homeRoot, port: 0, assistantRunner: captureRunner })
  const baseUrl = `http://127.0.0.1:${server.port}`

  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: {
      projectId,
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary', repoPath: repoRoot }],
    },
  })
  await requestJson(baseUrl, `/api/projects/${projectId}/preview/start`, { method: 'POST' })

  const input = await withTimeout(captured.promise, 10_000, 'Preview failure Assistant prompt')
  assert.match(input.prompt, /Project Preview start failed\./)
  assert.match(
    input.prompt,
    /Requested capability: make Project Preview work from the current Project state\./,
  )
  assert.match(input.prompt, /Adapter-declared prerequisites are implementation claims/)
  await waitForAssistantCompletion(homeRoot, input.eventId)

  await server.shutdown()
  server = null

  const configuredHome = process.env.HOPI_HOME_ROOT ?? join(homedir(), '.local', 'share', 'hopi')
  const adapterConfig = await readAgentAdapterConfig(agentAdapterConfigPath(configuredHome))
  const runner = createConfiguredAssistantModelRunner({
    resolveConfig: () => resolveAssistantTransportConfig(adapterConfig),
    resolveToolUrl: () => 'http://127.0.0.1:1/api/internal/assistant-tool',
  })
  const toolCalls: string[] = []
  const decisionPrompt = [
    input.prompt,
    '',
    '[Decision probe]',
    'Read-only diagnosis is complete: docs/hopi/preview/runbook.md says ordinary Preview Start must produce the intended experience without operator runtime inputs. The existing adapter exits only because it requires mybusinessSession and mystoreSession, prerequisites absent from the runbook and accepted Project facts.',
    'Do not call tools, inspect files, browse, edit, or execute any operation. Describe the exact HOPI decision and operations you would take if execution were enabled.',
    'Return JSON only with these keys: diagnosis (string), operations (array of objects with tool, arguments, and reason), executionPlan (array of strings in order), operatorQuestion (string or null), and acceptance (array of strings).',
    'Do not invent project-specific product facts that are absent from the current Project state.',
  ].join('\n')
  const result = await runner.run(
    {
      eventId: 'EV-preview-admission-probe',
      projectId,
      prompt: decisionPrompt,
      rebuildPrompt: decisionPrompt,
      session: null,
      cwd: modelRoot,
      lastMessageFile: join(modelRoot, 'last-message.txt'),
      transcriptFile: join(modelRoot, 'transcript.log'),
      toolUrl: 'http://127.0.0.1:1/api/internal/assistant-tool',
      toolToken: 'preview-admission-probe',
      toolMode: 'internal',
      invocation: 'speaking',
    },
    {
      onEvent(event) {
        if (event.kind === 'transcript' && event.entryKind === 'tool_call') {
          toolCalls.push(event.toolName ?? 'unknown')
        }
      },
    },
  )

  assert.deepEqual(toolCalls, [], `Decision probe must not execute tools: ${toolCalls.join(', ')}`)
  console.log(result.reply)
  const decision = parseDecision(result.reply)
  assertDecision(decision)

  console.log('Preview admission prompt eval passed.')
} finally {
  if (server) await server.shutdown().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}

function assertDecision(decision: PreviewAdmissionDecision) {
  const operations = normalize(JSON.stringify(decision.operations))
  assert.ok(
    operations.includes('goal') && hasAny(operations, ['create', '创建']),
    'Assistant must plan a Goal without waiting for another user turn',
  )
  assert.ok(
    hasAny(operations, ['engineering work', 'engineeringwork', 'engineering']),
    'Broken Preview capability must enter directly through Engineering Work',
  )
  assert.equal(
    decision.operatorQuestion,
    null,
    'An adapter prerequisite absent from accepted authority is not a product ambiguity',
  )

  const diagnosis = normalize(decision.diagnosis)
  assert.ok(
    hasAny(diagnosis, [
      'stale',
      'conflict',
      'contradict',
      'implementation claim',
      '过时',
      '冲突',
      '实现声明',
    ]),
    'Assistant must treat an unauthorized adapter prerequisite as stale implementation, not missing operator input',
  )

  const delivery = normalize(
    [decision.diagnosis, ...decision.executionPlan, JSON.stringify(decision.operations)].join('\n'),
  )
  assert.ok(
    hasAny(delivery, [
      'explore',
      'inspect',
      'research',
      'repo guidance',
      'source',
      '探索',
      '检查',
      '源码',
    ]),
    'Generator plan must begin from Project exploration',
  )
  assert.ok(
    hasAny(delivery, ['docs/hopi/preview/runbook.md', 'runbook']),
    'Generator plan must maintain docs/hopi/preview/runbook.md',
  )
  assert.ok(
    hasAny(delivery, ['implement', 'adapter', 'script', '实现', '适配器', '脚本']),
    'Generator plan must implement the Preview adapter',
  )
  assert.ok(
    hasAny(delivery, [
      'runbook-first',
      'before implementation',
      'before changing implementation',
      '实现前',
      '先更新 runbook',
      '先创建 runbook',
    ]),
    'Runbook understanding must be established before Preview implementation',
  )

  const acceptance = normalize(decision.acceptance.join('\n'))
  assert.ok(
    hasAny(acceptance, [
      'browser',
      'operate',
      'user experience',
      'actual experience',
      'intended behavior',
      'semantic',
      '浏览器',
      '操作',
      '真实体验',
    ]),
    'Reviewer acceptance must include actual user experience',
  )
  assert.ok(
    hasAny(acceptance, ['http', 'port', 'transport', '进程', '端口']) &&
      hasAny(acceptance, [
        'not enough',
        'insufficient',
        'not sufficient',
        'alone',
        'merely',
        'rather than',
        '不能',
        '不足',
        '不等于',
      ]),
    'Reviewer must not accept transport readiness as semantic success',
  )

  const proposed = normalize(
    [decision.diagnosis, ...decision.executionPlan, ...decision.acceptance].join('\n'),
  )
  assert.ok(
    !/(?:use|create|replace with|依赖|采用|创建|替换为).{0,24}(?:local )?mock/.test(proposed),
    'Assistant must not plan a local mock as the Preview outcome',
  )
}

function parseDecision(reply: string): PreviewAdmissionDecision {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  assert.ok(start >= 0 && end > start, `Assistant did not return a JSON object: ${reply}`)
  const parsed = JSON.parse(reply.slice(start, end + 1)) as Partial<PreviewAdmissionDecision>
  assert.equal(typeof parsed.diagnosis, 'string')
  assert.ok(Array.isArray(parsed.operations))
  assert.ok(Array.isArray(parsed.executionPlan))
  assert.ok(parsed.operatorQuestion === null || typeof parsed.operatorQuestion === 'string')
  assert.ok(Array.isArray(parsed.acceptance))
  return parsed as PreviewAdmissionDecision
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function hasAny(source: string, values: readonly string[]) {
  return values.some((value) => source.includes(value.toLowerCase()))
}

async function createRepo(path: string) {
  await mkdir(path, { recursive: true })
  await git(path, ['init', '-b', 'main'])
  await git(path, ['config', 'user.email', 'hopi@example.test'])
  await git(path, ['config', 'user.name', 'HOPI Eval'])
  await Bun.write(join(path, 'README.md'), '# Preview admission prompt eval\n')
  await mkdir(join(path, 'docs', 'hopi', 'preview'), { recursive: true })
  await Bun.write(
    join(path, 'docs', 'hopi', 'preview', 'runbook.md'),
    '# Preview runbook\n\nOrdinary Preview Start provides the intended experience without operator runtime inputs.\n',
  )
  const adapter = join(path, 'scripts', 'hopi', 'preview')
  await mkdir(join(path, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(
    adapter,
    '#!/bin/sh\necho "mybusinessSession and mystoreSession runtime inputs are required" >&2\nexit 1\n',
  )
  await chmod(adapter, 0o755)
  await git(path, ['add', '.'])
  await git(path, ['commit', '-m', 'initial fixture'])
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

async function requestJson(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`)
  return body
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForAssistantCompletion(homeRoot: string, eventId: string) {
  const path = join(homeRoot, '.hopi', 'runtime', 'assistant', 'turns', eventId, 'turn.json')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const file = Bun.file(path)
    if (await file.exists()) {
      const turn = (await file.json()) as { status?: unknown }
      if (turn.status === 'completed') return
    }
    await Bun.sleep(10)
  }
  throw new Error('Captured Preview failure Assistant turn did not settle')
}
