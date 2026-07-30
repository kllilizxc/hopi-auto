import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import { assistantMcpToolSchemas } from '../src/assistant/assistantToolSchemas'

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
      },
      stderr: 'pipe',
    })
    transports.add(transport)
    const client = new Client({ name: 'hopi-test', version: '1.0.0' })
    await client.connect(transport)

    const tools = await client.listTools()
    const result = await client.callTool({ name: 'hopi_read_state', arguments: {} })
    const manageResult = await client.callTool({
      name: 'hopi_manage_project',
      arguments: {
        change: {
          kind: 'create',
          projectId: 'P-customer-portal',
          label: 'Customer Portal',
          primaryRepoId: 'main',
          repos: [{ repoId: 'main', repoPath: '/tmp/customer-portal' }],
        },
      },
    })

    const names = tools.tools.map((tool) => tool.name).sort()
    expect(names).toEqual(
      [
        'hopi_control_goal',
        'hopi_control_preview',
        'hopi_control_work',
        'hopi_create_goal',
        'hopi_create_work',
        'hopi_manage_attention',
        'hopi_manage_project',
        'hopi_read_conversation',
        'hopi_read_state',
        'hopi_write_design',
        'hopi_write_preferences',
      ].sort(),
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_manage_project')?.description).toContain(
      'Create a Project',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_manage_project')?.description).toContain(
      'recovery validation',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_manage_project')?.description).toContain(
      'optional display label',
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_write_preferences')?.description,
    ).toContain('expectedDigest')
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).not.toContain(
      'sleeping or polling',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).toContain(
      'Engineering starts managed Generator delivery',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.description).toContain(
      'without a Planning pass',
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
      'managed Generator, Reviewer, Evidence, and recovery lifecycle',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.description).toContain(
      'normalized contract change',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_read_state')?.description).toContain(
      'current C1 candidate-integration preflight',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_read_state')?.description).toContain(
      'operatorUrl for user links',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_read_state')?.description).toContain(
      'inspectionPath is diagnostic only',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_write_design')?.description).toContain(
      'Goal-local design Markdown',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.description).toContain(
      'complete Work contract',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.description).not.toContain(
      'Use ',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_goal')?.description).toContain(
      'Goal lifecycle or priority',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_work')?.description).toContain(
      'change dependencies',
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_manage_attention')?.description,
    ).toContain('Attention stores an operator summary, optional choices, complete Agent detail')
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_manage_attention')?.inputSchema,
    ).toMatchObject({
      required: ['projectId', 'change'],
      properties: {
        projectId: { type: 'string' },
        change: { anyOf: expect.any(Array) },
      },
    })
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_preview')?.description).toContain(
      'bounded non-secret values',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_preview')?.description).toContain(
      'starts every runnable service',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_preview')?.description).toContain(
      'connects frontends to local backends',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_preview')?.description).toContain(
      'Do not gate Preview on database classification or writes',
    )
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_preview')?.description).toContain(
      'durable provider transcript',
    )
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_write_design')?.inputSchema,
    ).toMatchObject({
      properties: { projectId: { type: 'string' }, changes: { type: 'array' } },
    })
    expect(
      tools.tools.find((tool) => tool.name === 'hopi_manage_project')?.inputSchema,
    ).toMatchObject({ properties: { change: expect.any(Object) } })
    expect(
      JSON.stringify(
        toJsonSchemaCompat(assistantMcpToolSchemas.hopi_manage_project, {
          strictUnions: true,
          pipeStrategy: 'input',
        }),
      ),
    ).toContain('"label"')
    expect(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.inputSchema).toMatchObject(
      {
        properties: { work: expect.any(Object) },
      },
    )
    expect(
      JSON.stringify(tools.tools.find((tool) => tool.name === 'hopi_create_work')?.inputSchema),
    ).not.toContain('"repos"')
    expect(
      JSON.stringify(tools.tools.find((tool) => tool.name === 'hopi_create_goal')?.inputSchema),
    ).not.toContain('"repos"')
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
    expect(tools.tools.find((tool) => tool.name === 'hopi_control_work')?.description).toContain(
      'same responsibility lineage',
    )
    expect(tools.tools.every((tool) => (tool.description?.length ?? 0) < 650)).toBe(true)
    expect(result.isError).not.toBe(true)
    expect(manageResult.isError).not.toBe(true)
    expect(received).toEqual([
      { token: 'turn-token', name: 'hopi_read_state', arguments: {} },
      {
        token: 'turn-token',
        name: 'hopi_manage_project',
        arguments: {
          change: {
            kind: 'create',
            projectId: 'P-customer-portal',
            label: 'Customer Portal',
            primaryRepoId: 'main',
            repos: [{ repoId: 'main', repoPath: '/tmp/customer-portal' }],
          },
        },
      },
    ])
  })

  test('exposes the same Project tools to an internal wake', async () => {
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
        'hopi_manage_attention',
        'hopi_manage_project',
        'hopi_read_conversation',
        'hopi_read_state',
        'hopi_write_design',
        'hopi_write_preferences',
      ].sort(),
    )
    expect(tools.find((tool) => tool.name === 'hopi_manage_attention')).toBeDefined()
    expect(tools.find((tool) => tool.name === 'hopi_request_user')).toBeUndefined()
  })
})
