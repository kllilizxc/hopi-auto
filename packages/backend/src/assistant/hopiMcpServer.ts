import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { type AssistantToolName, assistantToolSchemas } from './assistantToolSchemas'

const toolUrl = requiredEnv('HOPI_TOOL_URL')
const token = requiredEnv('HOPI_TOOL_TOKEN')
const mode =
  process.env.HOPI_TOOL_MODE === 'reflection'
    ? 'reflection'
    : process.env.HOPI_TOOL_MODE === 'internal'
      ? 'internal'
      : 'main'
const server = new McpServer({ name: 'hopi', version: '1.0.0' })

server.registerTool(
  'hopi_read_state',
  {
    description:
      'Read compact current HOPI state, including active Runs, Work control facts, open Attention, latest Attempt diagnostics, and exact canonical document/log paths. Omit projectId and goalId to use the current page scope. Explicit IDs must be copied exactly, including P- and G- prefixes. Read a local path only when its exact body is needed.',
    inputSchema: assistantToolSchemas.hopi_read_state,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  (args) => callTool('hopi_read_state', args),
)

if (mode !== 'reflection') {
  server.registerTool(
    'hopi_create_goal',
    {
      description:
        'Create a new HOPI Goal, record the current user turn, and start its initial Planning when the user actually requests a new autonomous outcome. When a durable public Inbox image is relevant, include its exact attachmentRef and a free-form purpose in references so it is atomically adopted before Planning. A same-turn hopi_request_planning call is unnecessary. After success, reply immediately without sleeping or polling for workflow progress. Do not call this tool for questions or casual conversation.',
      inputSchema: assistantToolSchemas.hopi_create_goal,
    },
    (args) => callTool('hopi_create_goal', args),
  )

  server.registerTool(
    'hopi_write_design',
    {
      description:
        'Create or update Goal-local design Markdown with writes: [{ path, content }] (plus projectId, goalId, and optional references). Paths are relative to the selected Goal design root, for example index.md or architecture/api.md. Relevant durable public Inbox images may be adopted with references; HOPI records their Goal-local path and purpose in design/references.md. This is documentation-only; call hopi_request_planning separately when implementation should follow.',
      inputSchema: assistantToolSchemas.hopi_write_design,
    },
    (args) => callTool('hopi_write_design', args),
  )

  server.registerTool(
    'hopi_request_planning',
    {
      description:
        'Record a later user instruction against an existing Goal and ensure Planning. When durable public Inbox images matter to the requested work, select them by exact attachmentRef and state their purpose in references; unrelated images must be omitted. A same-instruction call after hopi_create_goal is unnecessary and idempotent. After success, reply immediately without sleeping or polling for workflow progress. Set materialContractChange only when objective, scope, constraints, non-goals, success criteria, or expected behavior changes.',
      inputSchema: assistantToolSchemas.hopi_request_planning,
    },
    (args) => callTool('hopi_request_planning', args),
  )

  server.registerTool(
    'hopi_control_goal',
    {
      description:
        'Pause, resume, cancel, reopen, or reprioritize a HOPI Goal requested by the user.',
      inputSchema: assistantToolSchemas.hopi_control_goal,
    },
    (args) => callTool('hopi_control_goal', args),
  )

  server.registerTool(
    'hopi_control_work',
    {
      description:
        'Retry, cancel, or schedule one Work item. This changes canonical Work control facts, never a Kanban column directly.',
      inputSchema: assistantToolSchemas.hopi_control_work,
    },
    (args) => callTool('hopi_control_work', args),
  )

  server.registerTool(
    'hopi_resolve_attention',
    {
      description:
        "Resolve an answered event- or Goal-target Attention after applying any required Goal or Work effects. Pass every required field in one call. Goal example: { scope: 'goal', projectId: 'P-...', goalId: 'G-...', attentionId: '...', resolution: '...' }. Workspace example: { scope: 'workspace', attentionId: '...', resolution: '...' }. Copy exact IDs from hopi_read_state or current-turn context. Project Attention requires deterministic repair and cannot be asserted away.",
      inputSchema: assistantToolSchemas.hopi_resolve_attention,
    },
    (args) => callTool('hopi_resolve_attention', args),
  )

  server.registerTool(
    'hopi_control_preview',
    {
      description:
        'Start or stop reviewed Preview, or request ordinary Planning when the adapter is missing or broken.',
      inputSchema: assistantToolSchemas.hopi_control_preview,
    },
    (args) => callTool('hopi_control_preview', args),
  )

  if (mode === 'internal') {
    server.registerTool(
      'hopi_notify_user',
      {
        description:
          'Request that the final reply for this internal Reflection turn be shown after the turn completes. Call only when the operator should learn a useful outcome or take action. Keep the reply focused on the outcome and action; omit internal IDs and process unless needed. Do not call when HOPI can continue silently.',
        inputSchema: assistantToolSchemas.hopi_notify_user,
      },
      (args) => callTool('hopi_notify_user', args),
    )
  }
} else {
  server.registerTool(
    'hopi_handoff_to_main',
    {
      description:
        'Submit one concise internal brief to the speaking Assistant only when current state warrants a reply or HOPI action. End silently when no action is useful.',
      inputSchema: assistantToolSchemas.hopi_handoff_to_main,
    },
    (args) => callTool('hopi_handoff_to_main', args),
  )
}

await server.connect(new StdioServerTransport())

async function callTool(name: AssistantToolName, args: unknown) {
  try {
    const response = await fetch(toolUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name, arguments: args }),
    })
    const result = (await response.json()) as { summary?: string; value?: unknown; error?: string }
    if (!response.ok) throw new Error(result.error ?? `HOPI tool returned ${response.status}`)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ summary: result.summary, value: result.value }),
        },
      ],
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: errorMessage(error) }],
    }
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
