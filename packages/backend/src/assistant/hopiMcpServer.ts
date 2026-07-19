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
      'Read compact current state: active Runs, Work, open Attention, latest diagnostics, and exact paths. For an exact deliverable, read its Goal with includeEvidence: true; inspect inspectionPath internally and link only operatorUrl to the user. Omit IDs for page scope; otherwise copy complete canonical IDs.',
    inputSchema: assistantToolSchemas.hopi_read_state,
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
          'Link or rebind Projects and Repos, or initialize an explicitly named empty directory. Use only operator-supplied paths.',
        inputSchema: assistantToolSchemas.hopi_manage_project,
      },
      (args) => callTool('hopi_manage_project', args),
    )

    server.registerTool(
      'hopi_configure_model',
      {
        description:
          'Set or inherit Assistant or Project coding defaults on explicit request; never changes Goal delivery.',
        inputSchema: assistantToolSchemas.hopi_configure_model,
      },
      (args) => callTool('hopi_configure_model', args),
    )

    server.registerTool(
      'hopi_write_preferences',
      {
        description:
          'Replace the complete cross-Project preference Markdown using the exact current expectedDigest. Preserve valid entries; store only reusable defaults, not one-off, current-task, or Project-specific rules. This remembers a default but does not change delivery.',
        inputSchema: assistantToolSchemas.hopi_write_preferences,
      },
      (args) => callTool('hopi_write_preferences', args),
    )
  }

  server.registerTool(
    'hopi_create_goal',
    {
      description:
        'Create a Goal, record the current turn, and start initial Planning for a requested autonomous outcome. Adopt relevant Inbox images with exact attachmentRef and purpose. Do not also request Planning in the same turn; do not create Goals for questions or casual conversation. Include the returned goalId in the reply.',
      inputSchema: assistantToolSchemas.hopi_create_goal,
    },
    (args) => callTool('hopi_create_goal', args),
  )

  server.registerTool(
    'hopi_write_design',
    {
      description:
        'Create or update Goal-local design Markdown. Write paths are relative to the Goal design root. Relevant Inbox images may be adopted by reference and purpose. This changes documentation only; request Planning separately when delivery should change.',
      inputSchema: assistantToolSchemas.hopi_write_design,
    },
    (args) => callTool('hopi_write_design', args),
  )

  server.registerTool(
    'hopi_request_planning',
    {
      description:
        'Adopt the current turn as Goal Input and ensure Planning. This may invalidate an active Planner, so use it only when current delivery should change, not for optional notes or future ideas. Adopt relevant Inbox images by exact attachmentRef and purpose. Do not call after same-turn Goal creation. Set materialContractChange only for an objective, scope, constraint, non-goal, success criterion, or expected-behavior change.',
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
        'Retry, cancel, or schedule one Work item. Retry/cancel also settle open Attention targeted exactly at affected Work; they never close broader or unrelated Attention. This changes canonical control facts, never a Kanban column directly.',
      inputSchema: assistantToolSchemas.hopi_control_work,
    },
    (args) => callTool('hopi_control_work', args),
  )

  server.registerTool(
    'hopi_resolve_attention',
    {
      description:
        'Resolve an exact answered or repaired Attention. Goal scope requires projectId and goalId; workspace/Project scope does not. Copy canonical IDs from state or turn context. Resolve only after the blocker is false or superseded, and claim it cleared only when this call succeeds.',
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
          'Publish one concise informational update after this internal Reflection turn completes. This never asks the operator to act and never creates Needs you. Use only alongside a durable internal continuation or for a completed outcome; omit internal IDs and process unless needed.',
        inputSchema: assistantToolSchemas.hopi_notify_user,
      },
      (args) => callTool('hopi_notify_user', args),
    )

    server.registerTool(
      'hopi_request_user',
      {
        description:
          'Ask for one exact operator decision, authorization, or external action that HOPI cannot supply. This transfers referenced open Attention to Needs you after the complete message is durable. Never use for status, diagnostics, or an issue Assistant can repair internally.',
        inputSchema: assistantToolSchemas.hopi_request_user,
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
