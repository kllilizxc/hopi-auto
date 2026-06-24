import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from '../src/index'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'manual-authoring-routes')
const servers: Array<ReturnType<typeof createServer>> = []
let counter = 0

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop(true)
  }

  await rm(tmpBase, { recursive: true, force: true })
})

async function startServer() {
  counter += 1
  const rootDir = join(tmpBase, String(counter))
  await mkdir(rootDir, { recursive: true })
  const server = createServer({
    rootDir,
    port: 0,
  })
  servers.push(server)
  return server
}

function apiUrl(server: ReturnType<typeof createServer>, path: string) {
  return `http://127.0.0.1:${server.port}${path}`
}

describe('manual authoring routes', () => {
  test('returns 404 for removed manual authoring endpoints', async () => {
    const server = await startServer()
    const cases = [
      ['/api/preferences', 'GET'],
      ['/api/preferences', 'POST'],
      ['/api/preferences/record', 'POST'],
      ['/api/preferences/retire', 'POST'],
      ['/api/goals/test/decisions', 'GET'],
      ['/api/goals/test/decisions', 'POST'],
      ['/api/goals/test/decisions/answer', 'POST'],
      ['/api/goals/test/decisions/answers', 'POST'],
      ['/api/goals/test/decisions/auth-strategy/resolve', 'POST'],
      ['/api/goals/test/planning-requests', 'GET'],
      ['/api/goals/test/planning-requests', 'POST'],
      ['/api/goals/test/planning-requests/workflows', 'GET'],
      ['/api/goals/test/planning-requests/workflows', 'POST'],
      ['/api/goals/test/planning-requests/workflows/auth-rollout', 'GET'],
      ['/api/goals/test/tasks', 'POST'],
      ['/api/goals/test/tasks/T-1/move', 'POST'],
    ] as const

    for (const [path, method] of cases) {
      const response = await fetch(apiUrl(server, path), {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      })
      expect(response.status).toBe(404)
    }
  })
})
