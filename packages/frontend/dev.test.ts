import { afterEach, describe, expect, test } from 'bun:test'
import { createFrontendDevServer } from './dev'

const servers = new Set<Bun.Server<unknown>>()

afterEach(() => {
  for (const server of servers) server.stop(true)
  servers.clear()
})

describe('frontend dev server', () => {
  test('serves React routes and proxies API requests to the backend', async () => {
    const backend = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        return Response.json({
          method: request.method,
          path: `${url.pathname}${url.search}`,
          body: request.method === 'POST' ? await request.json() : null,
        })
      },
    })
    servers.add(backend)
    const frontend = createFrontendDevServer({
      port: 0,
      backendOrigin: `http://127.0.0.1:${backend.port}`,
    })
    servers.add(frontend)
    const base = `http://127.0.0.1:${frontend.port}`

    for (const path of ['/', '/projects', '/projects/P-1/board/G-1']) {
      const response = await fetch(`${base}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('id="root"')
    }

    const response = await fetch(`${base}/api/inbox?source=frontend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })

    expect(await response.json()).toEqual({
      method: 'POST',
      path: '/api/inbox?source=frontend',
      body: { content: 'hello' },
    })
  })

  test('returns a useful 502 when the backend is unavailable', async () => {
    const frontend = createFrontendDevServer({
      port: 0,
      backendOrigin: 'http://127.0.0.1:1',
    })
    servers.add(frontend)

    const response = await fetch(`http://127.0.0.1:${frontend.port}/api/state`)
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(502)
    expect(body.error).toContain('Frontend dev proxy could not reach')
  })
})
