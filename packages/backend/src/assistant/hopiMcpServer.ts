import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { type AssistantToolName, assistantMcpToolSchemas } from './assistantToolSchemas'

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
      'Read current Home, Project, or Goal state. Goal state includes Work diagnostics, the current C1 candidate-integration preflight, and canonical Attention references. Evidence bodies and resolved artifacts are optional.',
    inputSchema: assistantMcpToolSchemas.hopi_read_state,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  (args) => callTool('hopi_read_state', args),
)

if (mode !== 'reflection') {
  server.registerTool(
    'hopi_read_conversation',
    {
      description:
        'Read a bounded page of durable public Assistant exchanges from Home or one Project without changing its provider session.',
      inputSchema: assistantMcpToolSchemas.hopi_read_conversation,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) => callTool('hopi_read_conversation', args),
  )
}

if (mode === 'main') {
  server.registerTool(
    'hopi_manage_project',
    {
      description:
        'Create a Project, add a Repo binding, or rebind moved Repos. Repo bindings are Project-local and may share one Git Repo; selected checkouts locate Git and remain unmodified.',
      inputSchema: assistantMcpToolSchemas.hopi_manage_project,
    },
    (args) => callTool('hopi_manage_project', args),
  )

  server.registerTool(
    'hopi_write_preferences',
    {
      description:
        'Replace the complete cross-Project preference Markdown when expectedDigest matches current state.',
      inputSchema: assistantMcpToolSchemas.hopi_write_preferences,
    },
    (args) => callTool('hopi_write_preferences', args),
  )
}

if (mode !== 'reflection') {
  server.registerTool(
    'hopi_create_goal',
    {
      description:
        'Create one Goal from the current Inbox turn and atomically create its first Planning or Engineering Work.',
      inputSchema: assistantMcpToolSchemas.hopi_create_goal,
    },
    (args) => callTool('hopi_create_goal', args),
  )

  server.registerTool(
    'hopi_create_work',
    {
      description:
        'Create one Planning or Engineering Work in an active Goal. A new Planning revision records its explicit normalized contract change; Engineering records a complete Work contract and dependencies.',
      inputSchema: assistantMcpToolSchemas.hopi_create_work,
    },
    (args) => callTool('hopi_create_work', args),
  )

  server.registerTool(
    'hopi_write_design',
    {
      description:
        'Write Goal-local design Markdown or adopt current Inbox attachments into Goal-local assets. This does not start Planning.',
      inputSchema: assistantMcpToolSchemas.hopi_write_design,
    },
    (args) => callTool('hopi_write_design', args),
  )

  server.registerTool(
    'hopi_control_goal',
    {
      description:
        'Change one Goal lifecycle or priority. Reopen advances its contract revision, optionally records a normalized contract change, and creates Planning.',
      inputSchema: assistantMcpToolSchemas.hopi_control_goal,
    },
    (args) => callTool('hopi_control_goal', args),
  )

  server.registerTool(
    'hopi_control_work',
    {
      description:
        'Retry, defer, or cancel one Work. Retry repeats unchanged Work authority and does not pass this Inbox turn to the role. Cancellation includes nonterminal dependents, interrupts their Runs, and preserves history.',
      inputSchema: assistantMcpToolSchemas.hopi_control_work,
    },
    (args) => callTool('hopi_control_work', args),
  )

  server.registerTool(
    'hopi_resolve_attention',
    {
      description: 'Resolve one canonical Attention condition and remove its scheduling gate.',
      inputSchema: assistantMcpToolSchemas.hopi_resolve_attention,
    },
    (args) => callTool('hopi_resolve_attention', args),
  )

  server.registerTool(
    'hopi_control_preview',
    {
      description: 'Start or stop the reviewed Project Preview runtime.',
      inputSchema: assistantMcpToolSchemas.hopi_control_preview,
    },
    (args) => callTool('hopi_control_preview', args),
  )

  if (mode === 'internal') {
    server.registerTool(
      'hopi_request_user',
      {
        description:
          "Transfer the selected open Attention references to the operator. The turn's non-empty final response becomes the question; this call sends no text.",
        inputSchema: assistantMcpToolSchemas.hopi_request_user,
      },
      (args) => callTool('hopi_request_user', args),
    )
  }
} else {
  server.registerTool(
    'hopi_handoff_to_main',
    {
      description:
        'Create one internal Inbox brief for the speaking Assistant, optionally linked to canonical Attention references from one scope.',
      inputSchema: assistantMcpToolSchemas.hopi_handoff_to_main,
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
