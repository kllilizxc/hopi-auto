import type { AssistantTransport } from '../../src/agent/vendorAssistantOutput'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { createServer } from '../../src/mvpServer'

const homeRoot = process.env.HOPI_E2E_HOME_ROOT
const port = Number.parseInt(process.env.HOPI_E2E_PORT ?? '', 10)
if (!homeRoot || !Number.isInteger(port)) {
  throw new Error('HOPI_E2E_HOME_ROOT and HOPI_E2E_PORT are required')
}

const transport = configuredTransport(process.env.HOPI_E2E_TRANSPORT)
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
const server = createServer({ rootDir: homeRoot, port, reflectionRunner })
console.log(`HOPI_E2E_COORDINATOR_READY=${server.port}`)

let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  void server.shutdown().finally(() => process.exit(0))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

function configuredTransport(value: string | undefined): AssistantTransport {
  if (value === 'claude' || value === 'opencode') return value
  return 'codex'
}
