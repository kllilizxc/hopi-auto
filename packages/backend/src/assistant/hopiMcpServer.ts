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
      'Read compact current state: active Runs, Work control facts, open Attention, the latest finished Planning outcome, latest diagnostics, and exact paths. Default output omits cumulative Evidence arrays. For an exact deliverable, read its Goal with includeEvidence: true; inspect inspectionPath internally and link only operatorUrl to the user. Omit IDs for page or Home scope. Otherwise copy exact Project and optional Goal IDs from Project state; never copy the Home ID from a home: reference into projectId.',
    inputSchema: assistantMcpToolSchemas.hopi_read_state,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  (args) => callTool('hopi_read_state', args),
)

if (mode !== 'reflection') {
  if (mode === 'main') {
    server.registerTool(
      'hopi_manage_project',
      {
        description:
          'Project topology operations. link_project links or rebinds an existing Git Repo. initialize_repository initializes an explicitly named empty directory or a missing leaf whose parent exists; it creates that leaf. Missing ancestors, non-empty non-Git directories, and nested worktrees are rejected.',
        inputSchema: assistantMcpToolSchemas.hopi_manage_project,
      },
      (args) => callTool('hopi_manage_project', args),
    )

    server.registerTool(
      'hopi_configure_model',
      {
        description:
          'Set or inherit one Assistant, Planner, Generator, or Reviewer model on explicit request; never changes Goal delivery.',
        inputSchema: assistantMcpToolSchemas.hopi_configure_model,
      },
      (args) => callTool('hopi_configure_model', args),
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

  server.registerTool(
    'hopi_create_goal',
    {
      description:
        'Creates a Goal, records the current Inbox Input, adopts selected image references, and creates exactly one supplied firstWork. A planning firstWork materializes Planning; an engineering firstWork materializes one Engineering Work at generate. The returned value contains the canonical Goal and Work identities.',
      inputSchema: assistantMcpToolSchemas.hopi_create_goal,
    },
    (args) => callTool('hopi_create_goal', args),
  )

  server.registerTool(
    'hopi_create_engineering_work',
    {
      description:
        'Records the current Inbox Input and creates one supplied Engineering Work at generate in an active Goal with no nonterminal Planning Work. The Work declares Repos and dependencies. One Inbox Input can directly admit at most one Engineering Work Home-wide.',
      inputSchema: assistantMcpToolSchemas.hopi_create_engineering_work,
    },
    (args) => callTool('hopi_create_engineering_work', args),
  )

  server.registerTool(
    'hopi_write_design',
    {
      description:
        'Creates or updates Goal-local design Markdown and can adopt selected Inbox images. Paths are relative to the Goal design root. The effect changes documentation only.',
      inputSchema: assistantMcpToolSchemas.hopi_write_design,
    },
    (args) => callTool('hopi_write_design', args),
  )

  server.registerTool(
    'hopi_start_planning',
    {
      description:
        'Records the current Inbox Input and materializes Planning for an active Goal. mode controls whether the contract revision changes. resolveAttention defaults to true and settles only current-turn Attention targeting that exact Planning Work; false preserves it.',
      inputSchema: assistantMcpToolSchemas.hopi_start_planning,
    },
    (args) => callTool('hopi_start_planning', args),
  )

  server.registerTool(
    'hopi_control',
    {
      description:
        'Applies one validated Goal or Work control transition. Reopening a done or cancelled Goal makes it active, increments contractRevision, clears completion, records the current Inbox Input, and materializes Planning. Retry and defer require a Work identity.',
      inputSchema: assistantMcpToolSchemas.hopi_control,
    },
    (args) => callTool('hopi_control', args),
  )

  server.registerTool(
    'hopi_resolve_attention',
    {
      description: 'Resolve one exact Attention after its reported condition is verified clear.',
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
      'hopi_notify_user',
      {
        description:
          'Set or revise the one concise informational update published after this internal Reflection turn completes. A later successful notify_user or request_user call replaces this turn-local final-message slot; only the final slot is shown. This never asks the operator to act and never creates Needs you. For a completed Goal, first read that exact Goal with includeEvidence: true and include a relevant available operatorUrl in Markdown; if no artifact resolves, say that no linked artifact was produced. A linkless completion is rejected while an available Evidence artifact exists. Use only alongside a durable internal continuation or for a completed outcome; omit internal IDs and process unless needed.',
        inputSchema: assistantMcpToolSchemas.hopi_notify_user,
      },
      (args) => callTool('hopi_notify_user', args),
    )

    server.registerTool(
      'hopi_request_user',
      {
        description:
          'Set or revise the one request for an exact operator decision, authorization, or external action that HOPI cannot supply. A later successful notify_user or request_user call replaces this turn-local final-message slot; only the final slot is shown. The message is the complete public turn: make it independently understandable by preserving the material cause, why progress is blocked, the exact need, non-obvious alternative effects, and a recommendation when one exists. This transfers referenced open Attention to Needs you after the message is durable. Never use for status, diagnostics, or an issue Assistant can repair internally.',
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
        'Submit one concise internal brief to the speaking Assistant only when current state warrants a reply or HOPI action. End silently when no action is useful.',
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
