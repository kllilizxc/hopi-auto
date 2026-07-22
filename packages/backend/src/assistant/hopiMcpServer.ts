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
      'Read state at observedAt. Home and Project reads are compact indexes; name one Goal for diagnostics. currentCandidateIntegration is live preflight. creationRationale is immutable Attention text from creation; open means unresolved, not still true. Attention includes a canonical reference: copy it verbatim. Evidence is omitted by default; use includeEvidence: true for an exact deliverable, inspect inspectionPath internally, and link only operatorUrl. Omit IDs for current page or Reflection scope, or Home when none exists. Otherwise use exact Project and Goal IDs; never use a Home ID as projectId.',
    inputSchema: assistantMcpToolSchemas.hopi_read_state,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  (args) => callTool('hopi_read_state', args),
)

if (mode === 'main') {
  server.registerTool(
    'hopi_manage_project',
    {
      description:
        'Create a Project, add one Repo binding, or partially rebind moved Repos. A Git Repo may be bound read-write by several Projects; only duplicate Git identities inside one Project conflict. The selected checkout locates Git and is never changed by delivery. Create and add link an existing Git checkout or safely initialize an explicitly selected empty directory or missing leaf before linking. Rebind never initializes. Paths, Repo IDs, and Project IDs are always explicit.',
      inputSchema: assistantMcpToolSchemas.hopi_manage_project,
    },
    (args) => callTool('hopi_manage_project', args),
  )

  server.registerTool(
    'hopi_write_preferences',
    {
      description:
        'Replace the complete cross-Project preference Markdown using the exact current expectedDigest. Preserve valid entries; store only reusable defaults, not one-off, current-task, or Project-specific rules. This remembers a default but does not change delivery.',
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
        'Create one Goal from the current instruction and exactly one first Work. Use firstWork.kind planning when clarification or decomposition remains; HOPI supplies its standard Planning contract. Use engineering only for one complete, verifiable Work and provide its full contract.',
      inputSchema: assistantMcpToolSchemas.hopi_create_goal,
    },
    (args) => callTool('hopi_create_goal', args),
  )

  server.registerTool(
    'hopi_create_work',
    {
      description:
        'Create exactly one Planning or Engineering Work in an existing active Goal. Planning selects same_contract or new_contract_revision and does not resolve Attention. Engineering requires a full contract, Repo scope, and dependencies. One Inbox instruction can directly admit at most one Engineering Work.',
      inputSchema: assistantMcpToolSchemas.hopi_create_work,
    },
    (args) => callTool('hopi_create_work', args),
  )

  server.registerTool(
    'hopi_write_design',
    {
      description:
        'Apply one or more Goal-local design changes. A document change writes Markdown beneath design/. An attachment change adopts one current Inbox image with a stated purpose. This changes documentation only and does not start Planning.',
      inputSchema: assistantMcpToolSchemas.hopi_write_design,
    },
    (args) => callTool('hopi_write_design', args),
  )

  server.registerTool(
    'hopi_control_goal',
    {
      description:
        'Apply one Goal lifecycle or priority action: pause, resume, cancel, reopen, or set_priority. Reopen advances the Goal contract and materializes Planning.',
      inputSchema: assistantMcpToolSchemas.hopi_control_goal,
    },
    (args) => callTool('hopi_control_goal', args),
  )

  server.registerTool(
    'hopi_control_work',
    {
      description:
        'Retry or defer one Work, or cancel one Engineering Work. Cancellation includes every nonterminal dependent and preserves history. Retry settles only the exact Work blocker.',
      inputSchema: assistantMcpToolSchemas.hopi_control_work,
    },
    (args) => callTool('hopi_control_work', args),
  )

  server.registerTool(
    'hopi_resolve_attention',
    {
      description:
        'Record that one exact reported condition is already clear. This removes that scheduling gate; it does not send a message or transfer ownership. Copy the complete canonical Attention reference from current state.',
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
          "Stage operator ownership for exactly the selected open Attention references. Then return the complete question as this turn's final response. This call sends no text by itself; an empty final response or stale, resolved, mismatched, targetless, or already operator-owned reference rejects the whole request.",
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
        'Submit one internal brief to the speaking Assistant. To hand off Attention, copy reference values verbatim from hopi_read_state. Select workspace Attention or Attention from exactly one Goal; never mix scopes. No scope or references are inferred. With no handoff call, Reflection produces no speaking turn.',
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
