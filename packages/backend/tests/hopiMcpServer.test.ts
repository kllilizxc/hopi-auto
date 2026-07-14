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

    expect(tools.tools.map((tool) => tool.name)).toContain('hopi_request_planning')
    expect(tools.tools.map((tool) => tool.name)).not.toContain('hopi_notify_user')
    expect(tools.tools).toHaveLength(8)
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).toContain(
      'reply immediately without sleeping or polling',
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_request_planning')?.description,
    ).toContain('same-instruction call after hopi_create_goal is unnecessary and idempotent')
    expect(tools.tools.find((tool) => tool.name === 'hopi_write_design')?.description).toContain(
      'writes: [{ path, content }]',
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_resolve_attention')?.description,
    ).toContain("Goal example: { scope: 'goal', projectId: 'P-...', goalId: 'G-...'")
    expect(result.isError).not.toBe(true)
    expect(received).toEqual([{ token: 'turn-token', name: 'hopi_read_state', arguments: {} }])
  })

  test('exposes notify only to an internal speaking-thread turn', async () => {
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

    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names).toContain('hopi_request_planning')
    expect(names).toContain('hopi_notify_user')
    expect(names).toHaveLength(9)
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
