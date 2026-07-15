import { join } from 'node:path'
import type { AssistantTransport } from '../../src/agent/vendorAssistantOutput'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { createServer } from '../../src/mvpServer'
import { acquireCoordinatorInstanceLock } from '../../src/publication/instanceLock'

const configuredHomeRoot = process.env.HOPI_E2E_HOME_ROOT
const port = Number.parseInt(process.env.HOPI_E2E_PORT ?? '', 10)
if (!configuredHomeRoot || !Number.isInteger(port)) {
  throw new Error('HOPI_E2E_HOME_ROOT and HOPI_E2E_PORT are required')
}
const homeRoot = configuredHomeRoot

const transport = configuredTransport(process.env.HOPI_E2E_TRANSPORT)
const instance = process.env.HOPI_E2E_INSTANCE ?? 'unknown'
const reflectionRunner: AssistantModelRunner = {
  async run(input) {
    if (input.toolMode !== 'reflection') {
      throw new Error('Focused restart Reflection runner received a speaking turn')
    }
    return {
      reply: '',
      session: { transport, sessionId: `restart-reflection-${crypto.randomUUID()}` },
    }
  },
}
const assistantRunner = createRestartAssistantRunner(instance, transport)
const instanceLock = await acquireCoordinatorInstanceLock(
  join(homeRoot, '.hopi', 'runtime', 'coordinator.lock'),
)
let server: ReturnType<typeof createServer>
try {
  server = createServer({ rootDir: homeRoot, port, assistantRunner, reflectionRunner })
} catch (error) {
  await instanceLock.release()
  throw error
}
console.log(`HOPI_E2E_COORDINATOR_READY=${server.port}`)

let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  void server
    .shutdown()
    .then(() => instanceLock.release())
    .finally(() => process.exit(0))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

function configuredTransport(value: string | undefined): AssistantTransport {
  if (value === 'claude' || value === 'opencode') return value
  return 'codex'
}

function createRestartAssistantRunner(
  coordinatorInstance: string,
  assistantTransport: AssistantTransport,
): AssistantModelRunner {
  return {
    async run(input, observer) {
      if (input.toolMode !== 'main') {
        throw new Error('Focused restart speaking runner received an internal turn')
      }
      await observer?.onEvent?.({
        kind: 'transcript',
        transport: 'process',
        entryKind: 'tool_call',
        summary: 'Write the idempotent Assistant restart design marker.',
        toolName: 'hopi_write_design',
      })
      const response = await fetch(input.toolUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: input.toolToken,
          name: 'hopi_write_design',
          arguments: {
            projectId: 'P-process-restart',
            goalId: 'G-assistant-restart',
            writes: [
              {
                path: 'assistant-restart.md',
                content:
                  '# Assistant restart\n\nThe durable tool effect survived the pre-reply process crash.\n',
              },
            ],
          },
        }),
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok)
        throw new Error(result.error ?? `Assistant tool failed (${response.status})`)
      await observer?.onEvent?.({
        kind: 'transcript',
        transport: 'process',
        entryKind: 'tool_result',
        summary: 'The Assistant restart design marker is durable.',
        toolName: 'hopi_write_design',
      })

      if (coordinatorInstance === 'assistant-first') {
        await Bun.write(
          join(homeRoot, '.hopi', 'runtime', 'assistant', 'restart-tool-checkpoint.json'),
          `${JSON.stringify({ eventId: input.eventId, applied: true }, null, 2)}\n`,
        )
        await new Promise<void>((_, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => reject(new Error('Assistant restart fixture interrupted')),
            { once: true },
          )
        })
      }

      return {
        reply: 'The requested design update was recorded once.',
        session: {
          transport: assistantTransport,
          sessionId: `restart-assistant-${input.eventId}`,
        },
      }
    },
  }
}
