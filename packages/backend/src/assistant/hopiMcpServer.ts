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
      'Read compact current state: active Runs, Work control facts, open Attention, the latest finished Planning outcome, latest diagnostics, and exact paths. Default output omits cumulative Evidence arrays. For an exact deliverable, read its Goal with includeEvidence: true; inspect inspectionPath internally and link only operatorUrl to the user. Omit IDs for page scope; otherwise copy complete canonical IDs.',
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
          'Set or inherit one Assistant, Planner, Generator, or Reviewer model on explicit request; never changes Goal delivery.',
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
        'Create a Goal and record this turn. Set singular initialWork for one cohesive, verifiable delivery; omit it for Planning. Direct Work does not complete the Goal. Adopt images by attachmentRef and purpose. Include the returned goalId.',
      inputSchema: assistantToolSchemas.hopi_create_goal,
    },
    (args) => callTool('hopi_create_goal', args),
  )

  server.registerTool(
    'hopi_create_engineering_work',
    {
      description:
        'Adopt turn to create at most one Engineering Work in an active Goal; one turn gets one Home-wide direct Work. Include Repos and dependencies. Use Planning for multiple Work or Goal/design/Work/DAG changes. Adopt images by attachmentRef and purpose.',
      inputSchema: assistantToolSchemas.hopi_create_engineering_work,
    },
    (args) => callTool('hopi_create_engineering_work', args),
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
    'hopi_start_planning',
    {
      description:
        'Use when one accepted instruction requires Planner to revise authority, design, Work, dependencies, or a multi-Work plan. Does not retry Work or resolve Attention. Guarantees one current Planning guard; choose new_contract_revision only when Goal outcome, scope, constraints, success, or behavior changes. Never combine this with hopi_answer_attention revise for the same Goal: revise already starts or refreshes Planning.',
      inputSchema: assistantToolSchemas.hopi_start_planning,
    },
    (args) => callTool('hopi_start_planning', args),
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
    'hopi_retry_work',
    {
      description:
        'Use to authorize another invocation in one unchanged Work outcome, contract, DAG, and delivery boundary, including after transient setup, network, provider, or capacity failure. Does not revise authority or claim an environment repair. Guarantees the Work reset and settlement of Attention targeted exactly at that Work; trust the returned continuation and failed predicates.',
      inputSchema: assistantToolSchemas.hopi_retry_work,
    },
    (args) => callTool('hopi_retry_work', args),
  )

  server.registerTool(
    'hopi_cancel_work',
    {
      description:
        'Use only when one Engineering Work is explicitly no longer wanted. Does not mean retry or repair. Guarantees terminal cancellation of it and dependent Work, settlement of their exact Attention, and a Planning guard for reassessment.',
      inputSchema: assistantToolSchemas.hopi_cancel_work,
    },
    (args) => callTool('hopi_cancel_work', args),
  )

  server.registerTool(
    'hopi_defer_work',
    {
      description:
        'Use only to set or clear one Work notBefore time. Does not retry, revise, cancel, or resolve Attention. Guarantees only the validated scheduling field changes.',
      inputSchema: assistantToolSchemas.hopi_defer_work,
    },
    (args) => callTool('hopi_defer_work', args),
  )

  server.registerTool(
    'hopi_answer_attention',
    {
      description:
        'Use one exact canonical attentionRef after an operator answer or represented repair. retry means another invocation of the unchanged Work, including after transient setup/network/provider/capacity failure; revise alone starts Planning and means represented authority or delivery structure must change. Never call hopi_start_planning for the same revision. continue resumes the current responsibility and cancel abandons the Work. Does not affect unrelated Attention and guarantees the named effect precedes settlement, while revise returns the open blocker to Assistant ownership until the change clears it.',
      inputSchema: assistantToolSchemas.hopi_answer_attention,
    },
    (args) => callTool('hopi_answer_attention', args),
  )

  server.registerTool(
    'hopi_control_preview',
    {
      description: 'Start or stop the reviewed Project Preview runtime.',
      inputSchema: assistantToolSchemas.hopi_control_preview,
    },
    (args) => callTool('hopi_control_preview', args),
  )

  if (mode === 'internal') {
    server.registerTool(
      'hopi_notify_user',
      {
        description:
          'Set or revise the one concise informational update published after this internal Reflection turn completes. A later successful notify_user or request_user call replaces this turn-local final-message slot; only the final slot is shown. This never asks the operator to act and never creates Needs you. For a completed Goal, first read that exact Goal with includeEvidence: true and include a relevant available operatorUrl in Markdown; if no artifact resolves, say that no linked artifact was produced. A linkless completion is rejected while an available Evidence artifact exists. Use only alongside a durable internal continuation or for a completed outcome; omit internal IDs and process unless needed.',
        inputSchema: assistantToolSchemas.hopi_notify_user,
      },
      (args) => callTool('hopi_notify_user', args),
    )

    server.registerTool(
      'hopi_request_user',
      {
        description:
          'Set or revise the one request for an exact operator decision, authorization, or external action that HOPI cannot supply. A later successful notify_user or request_user call replaces this turn-local final-message slot; only the final slot is shown. The message is the complete public turn: make it independently understandable by preserving the material cause, why progress is blocked, the exact need, non-obvious alternative effects, and a recommendation when one exists. This transfers referenced open Attention to Needs you after the message is durable. Never use for status, diagnostics, or an issue Assistant can repair internally.',
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
