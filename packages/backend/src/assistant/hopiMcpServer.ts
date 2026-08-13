import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { type AssistantToolName, assistantMcpToolSchemas } from './assistantToolSchemas'

const toolUrl = requiredEnv('HOPI_TOOL_URL')
const token = requiredEnv('HOPI_TOOL_TOKEN')
const server = new McpServer({ name: 'hopi', version: '1.0.0' })

server.registerTool(
  'hopi_read_state',
  {
    description:
      'Read current Home, Project, or Goal state. Goal state includes Work diagnostics, the current C1 candidate-integration preflight, and canonical Attention references. Optional resolved Evidence artifacts expose operatorUrl for user links; inspectionPath is diagnostic only.',
    inputSchema: assistantMcpToolSchemas.hopi_read_state,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  (args) => callTool('hopi_read_state', args),
)

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

server.registerTool(
  'hopi_manage_project',
  {
    description:
      'Create a Project with an optional display label, change its Repo bindings, or rerun deterministic recovery validation. Repo bindings are Project-local and selected checkouts remain unmodified.',
    inputSchema: assistantMcpToolSchemas.hopi_manage_project.shape,
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

server.registerTool(
  'hopi_create_goal',
  {
    description:
      'Create one Goal from the current Inbox turn and atomically create its first visible Work. Choose Planning for unresolved meaning or Engineering for an already concrete unit; later execution uses explicit Run instructions, profiles, and workspace modes rather than a mandatory role pipeline.',
    inputSchema: assistantMcpToolSchemas.hopi_create_goal,
  },
  (args) => callTool('hopi_create_goal', args),
)

server.registerTool(
  'hopi_create_work',
  {
    description:
      'Create one visible Work in an active Goal. Planning records a normalized contract change; Engineering records a concrete objective, acceptance meaning, and optional dependencies. Creation does not imply a mandatory Generator/Reviewer sequence.',
    inputSchema: assistantMcpToolSchemas.hopi_create_work,
  },
  (args) => callTool('hopi_create_work', args),
)

server.registerTool(
  'hopi_write_design',
  {
    description:
      'Write or replace Goal-local design Markdown, or adopt current Inbox attachments into Goal-local assets. The resulting design is supplied as authority to later responsibilities and future Assistant state; this does not start Planning.',
    inputSchema: assistantMcpToolSchemas.hopi_write_design,
  },
  (args) => callTool('hopi_write_design', args),
)

server.registerTool(
  'hopi_control_goal',
  {
    description:
      'Explicitly complete a Goal from current acceptance meaning, change its lifecycle or priority, or reopen it. Completion is a semantic decision and is blocked by nonterminal Work or active Runs; it is never inferred from a Work count.',
    inputSchema: assistantMcpToolSchemas.hopi_control_goal,
  },
  (args) => callTool('hopi_control_goal', args),
)

server.registerTool(
  'hopi_control_work',
  {
    description:
      'Run explicit instructions for one Work with an independently selected execution profile and workspace mode, explicitly complete it, continue its legacy compatibility flow, change dependencies, or cancel it. A run produces a durable natural-language Report and never implies Work completion or a fixed Planner/Generator/Reviewer transition. isolated_write source is frozen as an unaccepted ChangeSet.',
    inputSchema: assistantMcpToolSchemas.hopi_control_work,
  },
  (args) => callTool('hopi_control_work', args),
)

server.registerTool(
  'hopi_control_operation',
  {
    description:
      'Propose, execute, or cancel one typed delivery Operation. baseline_integration validates the ChangeSet base and preserves candidate Git ancestry; archive creates a durable ZIP. requiredForGoal is explicit per Operation—optional delivery never becomes a hidden completion gate.',
    inputSchema: assistantMcpToolSchemas.hopi_control_operation,
  },
  (args) => callTool('hopi_control_operation', args),
)

server.registerTool(
  'hopi_manage_attention',
  {
    description:
      'Create, update, resolve, or present durable Project Attention. Attention stores an operator summary, optional choices, complete Agent detail, and traceability references. Presentation links current open Attention to this turn; it does not resolve it or change Work scheduling.',
    inputSchema: assistantMcpToolSchemas.hopi_manage_attention,
  },
  (args) => callTool('hopi_manage_attention', args),
)

server.registerTool(
  'hopi_control_preview',
  {
    description:
      'Start/stop Preview. Goal: an operator entry opens with mockable authentication and useful visible data; prefer local data, then DEV. A failed service is evidence, not Goal scope. Work states experience acceptance only; failed topology and old runbook restrictions are replaceable unless current operator input requires them. Read/update the runbook, explore source then relevant knowledge, start and browser-check the shortest path before broad tests, and ask only for one undiscoverable fact. Expose operator entries only. Reachability alone is insufficient: page and data must work. Stop cleans owned resources.',
    inputSchema: assistantMcpToolSchemas.hopi_control_preview,
  },
  (args) => callTool('hopi_control_preview', args),
)

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
