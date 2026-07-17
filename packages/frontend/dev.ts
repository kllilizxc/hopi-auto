import indexPage from './index.html'

export interface FrontendDevServerOptions {
  port?: number
  backendOrigin?: string
  hmr?: boolean
}

export function createFrontendDevServer(options: FrontendDevServerOptions = {}) {
  const backendOrigin = new URL(
    options.backendOrigin ?? process.env.HOPI_BACKEND_URL ?? 'http://127.0.0.1:3000',
  )
  const hmr = options.hmr ?? readHmr(process.env.HOPI_FRONTEND_HMR)

  let port = options.port ?? readPort(process.env.HOPI_FRONTEND_PORT, 5173)
  const maxPort = port + 100

  while (true) {
    try {
      return Bun.serve({
        port,
        routes: {
          '/': indexPage,
          '/projects': indexPage,
          '/projects/*': indexPage,
        },
        development: hmr ? { hmr: true, console: true } : false,
        async fetch(request) {
          const source = new URL(request.url)
          if (source.pathname !== '/api' && !source.pathname.startsWith('/api/')) {
            return new Response('Not found', { status: 404 })
          }

          const target = new URL(`${source.pathname}${source.search}`, backendOrigin)
          const headers = new Headers(request.headers)
          headers.delete('host')
          headers.delete('content-length')

          try {
            return await fetch(target, {
              method: request.method,
              headers,
              body:
                request.method === 'GET' || request.method === 'HEAD'
                  ? undefined
                  : await request.arrayBuffer(),
              redirect: 'manual',
            })
          } catch (error) {
            return Response.json(
              {
                error: `Frontend dev proxy could not reach ${backendOrigin.origin}: ${errorMessage(error)}`,
              },
              { status: 502 },
            )
          }
        },
      })
    } catch (error: any) {
      if (error.code === 'EADDRINUSE' && port < maxPort) {
        port++
      } else {
        throw error
      }
    }
  }
}

function readPort(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid HOPI_FRONTEND_PORT: ${value}`)
  }
  return port
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function readHmr(value: string | undefined) {
  return value !== '0' && value !== 'false'
}

if (import.meta.main) {
  const server = createFrontendDevServer()
  const mode = readHmr(process.env.HOPI_FRONTEND_HMR) ? 'HMR' : 'remote optimized'
  console.log(
    `HOPI frontend listening on http://localhost:${server.port} (${mode}; API: ${process.env.HOPI_BACKEND_URL ?? 'http://127.0.0.1:3000'})`,
  )
}
