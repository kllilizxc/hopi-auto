import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRuntimeEvent } from '../src/agent/runtimeEvents'
import { runCodexAssistantFork } from '../src/assistant/codexAssistantFork'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'codex-assistant-fork')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

test('forks a Codex thread through app-server and runs only the branch turn', async () => {
  const binary = join(temporaryRoot, 'fake-codex-app-server')
  const requestsFile = join(temporaryRoot, 'requests.json')
  await Bun.write(
    binary,
    [
      '#!/usr/bin/env bun',
      'const requests = []',
      `const requestsFile = ${JSON.stringify(requestsFile)}`,
      'const send = (value) => console.log(JSON.stringify(value))',
      'const reader = Bun.stdin.stream().getReader()',
      'const decoder = new TextDecoder()',
      "let buffered = ''",
      'while (true) {',
      '  const { done, value } = await reader.read()',
      '  if (done) break',
      '  buffered += decoder.decode(value, { stream: true })',
      '  const lines = buffered.split(/\\r?\\n/)',
      "  buffered = lines.pop() ?? ''",
      '  for (const line of lines) {',
      '    if (!line.trim()) continue',
      '    const message = JSON.parse(line)',
      '    requests.push(message)',
      '    await Bun.write(requestsFile, JSON.stringify(requests))',
      '    if (message.method === "initialize") send({id:0,result:{userAgent:"fake"}})',
      '    if (message.method === "thread/fork") send({id:1,result:{thread:{id:"codex-branch"}}})',
      '    if (message.method === "turn/start") {',
      '      send({id:2,result:{turn:{id:"turn-branch",status:"inProgress"}}})',
      '      send({method:"item/started",params:{threadId:"codex-branch",turnId:"turn-branch",item:{type:"mcpToolCall",id:"tool-1",server:"hopi",tool:"hopi_read_state",status:"inProgress"}}})',
      '      send({method:"item/completed",params:{threadId:"codex-branch",turnId:"turn-branch",item:{type:"mcpToolCall",id:"tool-1",server:"hopi",tool:"hopi_read_state",status:"completed",result:{content:"ok"}}}})',
      '      send({method:"item/completed",params:{threadId:"codex-branch",turnId:"turn-branch",item:{type:"agentMessage",id:"message-1",text:"No action."}}})',
      '      send({method:"turn/completed",params:{threadId:"codex-branch",turn:{id:"turn-branch",status:"completed",items:[]}}})',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
  )
  await chmod(binary, 0o755)
  const events: AgentRuntimeEvent[] = []
  const branches: string[] = []

  const result = await runCodexAssistantFork(
    {
      command: [binary],
      cwd: temporaryRoot,
      environment: { ...process.env },
      parentSessionId: 'codex-parent',
      prompt: 'Inspect the latest rejection.',
      fullAccess: true,
      transcriptFile: join(temporaryRoot, 'transcript.log'),
      lastMessageFile: join(temporaryRoot, 'last-message.txt'),
    },
    {
      onEvent: (event) => {
        events.push(event)
      },
      onSession: (sessionId) => {
        branches.push(sessionId)
      },
    },
  )

  const requests = (await Bun.file(requestsFile).json()) as Array<{
    method?: string
    params?: Record<string, unknown>
  }>
  expect(requests.find((request) => request.method === 'initialize')?.params).toMatchObject({
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
    },
  })
  expect(requests.find((request) => request.method === 'thread/fork')?.params).toMatchObject({
    threadId: 'codex-parent',
    ephemeral: true,
    excludeTurns: true,
  })
  expect(requests.find((request) => request.method === 'turn/start')?.params).toMatchObject({
    threadId: 'codex-branch',
  })
  expect(JSON.stringify(requests)).toContain('Inspect the latest rejection.')
  expect(result).toEqual({ reply: 'No action.', sessionId: 'codex-branch' })
  expect(branches).toEqual(['codex-branch'])
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: 'transcript',
      entryKind: 'tool_call',
      toolName: 'hopi_read_state',
    }),
  )
})

test('fails the fork instead of hanging when runtime event persistence fails', async () => {
  const binary = join(temporaryRoot, 'failing-event-codex-app-server')
  await Bun.write(
    binary,
    [
      '#!/usr/bin/env bun',
      'const send = (value) => console.log(JSON.stringify(value))',
      'for await (const line of console) {',
      '  const message = JSON.parse(line)',
      '  if (message.method === "initialize") send({id:0,result:{}})',
      '  if (message.method === "thread/fork") send({id:1,result:{thread:{id:"codex-branch"}}})',
      '  if (message.method === "turn/start") {',
      '    send({id:2,result:{turn:{id:"turn-branch",status:"inProgress"}}})',
      '    send({method:"item/completed",params:{threadId:"codex-branch",turnId:"turn-branch",item:{type:"agentMessage",id:"message-1",text:"No action."}}})',
      '  }',
      '}',
      '',
    ].join('\n'),
  )
  await chmod(binary, 0o755)

  await expect(
    runCodexAssistantFork(
      {
        command: [binary],
        cwd: temporaryRoot,
        environment: { ...process.env },
        parentSessionId: 'codex-parent',
        prompt: 'Inspect.',
        fullAccess: true,
        transcriptFile: join(temporaryRoot, 'transcript.log'),
        lastMessageFile: join(temporaryRoot, 'last-message.txt'),
        signal: AbortSignal.timeout(2_000),
      },
      {
        onEvent() {
          throw new Error('event sink failed')
        },
      },
    ),
  ).rejects.toThrow('event sink failed')
})
