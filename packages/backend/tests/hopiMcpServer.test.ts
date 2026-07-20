import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transports = new Set<StdioClientTransport>()
const servers = new Set<Bun.Server<undefined>>()

afterEach(async () => {
  await Promise.all([...transports].map((transport) => transport.close()))
  transports.clear()
  for (const server of servers) server.stop(true)
  servers.clear()
})

describe('HOPI MCP server', () => {
  test('exposes HOPI tools and forwards calls through the per-turn capability', async () => {
    const received: unknown[] = []
    const api = Bun.serve({
      port: 0,
      async fetch(request) {
        received.push(await request.json())
        return Response.json({ summary: 'Read state.', changed: false, value: { projects: [] } })
      },
    })
    servers.add(api)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dir, '../src/assistant/hopiMcpServer.ts')],
      env: {
        ...process.env,
        HOPI_TOOL_URL: `http://127.0.0.1:${api.port}/api/internal/assistant-tool`,
        HOPI_TOOL_TOKEN: 'turn-token',
        HOPI_TOOL_MODE: 'main',
      },
      stderr: 'pipe',
    })
    transports.add(transport)
    const client = new Client({ name: 'hopi-test', version: '1.0.0' })
    await client.connect(transport)

    const tools = await client.listTools()
    const result = await client.callTool({ name: 'hopi_read_state', arguments: {} })

    const names = tools.tools.map((tool) => tool.name)
    expect(names).toContain('hopi_start_planning')
    expect(names).toContain('hopi_create_engineering_work')
    expect(names).toContain('hopi_write_preferences')
    expect(names).toContain('hopi_manage_project')
    expect(names).toContain('hopi_configure_model')
    expect(names).toContain('hopi_retry_work')
    expect(names).toContain('hopi_cancel_work')
    expect(names).toContain('hopi_defer_work')
    expect(names).toContain('hopi_answer_attention')
    expect(names).not.toContain('hopi_control_work')
    expect(names).not.toContain('hopi_resolve_attention')
    expect(names).not.toContain('hopi_notify_user')
    expect(names).not.toContain('hopi_request_user')
    expect(tools.tools).toHaveLength(14)
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_write_preferences')?.description,
    ).toContain('reusable defaults')
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).not.toContain(
      'sleeping or polling',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).toContain(
      'Include the returned goalId',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_start_planning')?.description).toContain(
      'Does not retry Work or resolve Attention',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_start_planning')?.description).toContain(
      'new_contract_revision',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_read_state')?.description).toContain(
      'includeEvidence: true',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_read_state')?.description).toContain(
      'link only operatorUrl',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_write_design')?.description).toContain(
      'relative to the Goal design root',
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_create_engineering_work')?.description,
    ).toContain('at most one Engineering Work')
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_answer_attention')?.description,
    ).toContain('revise alone starts Planning')
    const answerSchema = tools.tools.find(
      (tool) => tool.name === 'hopi_answer_attention',
    )?.inputSchema
    expect(answerSchema).toMatchObject({
      type: 'object',
      properties: {
        attentionRef: { type: 'string' },
        decision: { enum: ['continue', 'retry', 'cancel', 'revise'] },
      },
    })
    expect(JSON.stringify(answerSchema)).not.toContain('anyOf')
    expect(JSON.stringify(answerSchema)).not.toContain('oneOf')
    expect(tools.tools.every((tool) => (tool.description?.length ?? 0) < 650)).toBe(true)
    expect(result.isError).not.toBe(true)
    expect(received).toEqual([{ token: 'turn-token', name: 'hopi_read_state', arguments: {} }])
  })

  test('exposes informational and request delivery only to an internal speaking-thread turn', async () => {
    const api = Bun.serve({
      port: 0,
      fetch: () => Response.json({ summary: 'Ready.', changed: false, value: {} }),
    })
    servers.add(api)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dir, '../src/assistant/hopiMcpServer.ts')],
      env: {
        ...process.env,
        HOPI_TOOL_URL: `http://127.0.0.1:${api.port}/api/internal/assistant-tool`,
        HOPI_TOOL_TOKEN: 'internal-token',
        HOPI_TOOL_MODE: 'internal',
      },
      stderr: 'pipe',
    })
    transports.add(transport)
    const client = new Client({ name: 'hopi-internal-test', version: '1.0.0' })
    await client.connect(transport)

    const tools = (await client.listTools()).tools
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('hopi_start_planning')
    expect(names).toContain('hopi_create_engineering_work')
    expect(names).toContain('hopi_notify_user')
    expect(names).toContain('hopi_request_user')
    expect(names).not.toContain('hopi_write_preferences')
    expect(names).not.toContain('hopi_manage_project')
    expect(names).not.toContain('hopi_configure_model')
    expect(names).toHaveLength(13)
    expect(tools.find((tool) => tool.name === 'hopi_request_user')?.description).toContain(
      'complete public turn',
    )
    expect(tools.find((tool) => tool.name === 'hopi_request_user')?.description).toContain(
      'material cause',
    )
  })

  test('limits Reflection to state read and one handoff tool', async () => {
    const api = Bun.serve({
      port: 0,
      fetch: () => Response.json({ summary: 'Read state.', changed: false, value: {} }),
    })
    servers.add(api)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dir, '../src/assistant/hopiMcpServer.ts')],
      env: {
        ...process.env,
        HOPI_TOOL_URL: `http://127.0.0.1:${api.port}/api/internal/assistant-tool`,
        HOPI_TOOL_TOKEN: 'reflection-token',
        HOPI_TOOL_MODE: 'reflection',
      },
      stderr: 'pipe',
    })
    transports.add(transport)
    const client = new Client({ name: 'hopi-reflection-test', version: '1.0.0' })
    await client.connect(transport)

    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
      'hopi_handoff_to_main',
      'hopi_read_state',
    ])
  })
})
