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

    const names = tools.tools.map((tool) => tool.name).sort()
    expect(names).toEqual(
      [
        'hopi_control_goal',
        'hopi_control_preview',
        'hopi_control_work',
        'hopi_create_goal',
        'hopi_create_work',
        'hopi_manage_project',
        'hopi_read_state',
        'hopi_resolve_attention',
        'hopi_write_design',
        'hopi_write_preferences',
      ].sort(),
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_manage_project')?.description).toContain(
      'Create a Project',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_manage_project')?.description).toContain(
      'missing leaf',
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_write_preferences')?.description,
    ).toContain('reusable defaults')
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).not.toContain(
      'sleeping or polling',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).toContain(
      'exactly one first Work',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).not.toContain(
      'Choose planning',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.inputSchema).toMatchObject(
      {
        required: expect.arrayContaining(['projectId', 'title', 'objective', 'firstWork']),
        properties: {
          firstWork: { anyOf: expect.any(Array) },
        },
      },
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.description).toContain(
      'Planning or Engineering Work',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.description).toContain(
      'does not resolve Attention',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_read_state')?.description).toContain(
      'includeEvidence: true',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_read_state')?.description).toContain(
      'link only operatorUrl',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_write_design')?.description).toContain(
      'beneath design/',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.description).toContain(
      'full contract',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_goal')?.description).toContain(
      'Goal lifecycle or priority action',
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_resolve_attention')?.description,
    ).toContain('removes that scheduling gate')
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_write_design')?.inputSchema,
    ).toMatchObject({
      properties: { projectId: { type: 'string' }, changes: { type: 'array' } },
    })
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_manage_project')?.inputSchema,
    ).toMatchObject({ properties: { change: expect.any(Object) } })
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.inputSchema).toMatchObject(
      {
        properties: { work: expect.any(Object) },
      },
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_control_goal')?.inputSchema,
    ).toMatchObject({
      properties: { action: expect.any(Object) },
    })
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_control_work')?.inputSchema,
    ).toMatchObject({
      properties: { action: expect.any(Object) },
    })
    expect(tools.tools.every((tool) => (tool.description?.length ?? 0) < 650)).toBe(true)
    expect(result.isError).not.toBe(true)
    expect(received).toEqual([{ token: 'turn-token', name: 'hopi_read_state', arguments: {} }])
  })

  test('exposes request staging but not Project settings to an internal speaking turn', async () => {
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
    expect(names.sort()).toEqual(
      [
        'hopi_control_goal',
        'hopi_control_preview',
        'hopi_control_work',
        'hopi_create_goal',
        'hopi_create_work',
        'hopi_read_state',
        'hopi_request_user',
        'hopi_resolve_attention',
        'hopi_write_design',
      ].sort(),
    )
    expect(tools.find((tool) => tool.name === 'hopi_request_user')?.description).toContain(
      'final response',
    )
    expect(tools.find((tool) => tool.name === 'hopi_request_user')?.description).toContain(
      'sends no text by itself',
    )
    expect(tools.find((tool) => tool.name === 'hopi_request_user')?.inputSchema).toMatchObject({
      required: ['attentionRefs'],
      properties: { attentionRefs: { type: 'array' } },
    })
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
