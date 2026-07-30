import { z } from 'zod'
import type { CursorPageRequest } from '../presentation/cursorPage'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  return schema.parse(await request.json())
}

export function readPageRequest(
  url: URL,
  defaultLimit: number,
  maxLimit: number,
): CursorPageRequest {
  const before = url.searchParams.get('before') ?? undefined
  const after = url.searchParams.get('after') ?? undefined
  if (before && after) throw new ApiError(400, 'before and after are mutually exclusive')
  const rawLimit = url.searchParams.get('limit')
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
    throw new ApiError(400, 'limit must be a positive integer')
  }
  const requestedLimit = rawLimit === null ? defaultLimit : Number.parseInt(rawLimit, 10)
  if (requestedLimit < 1) throw new ApiError(400, 'limit must be a positive integer')
  return {
    before,
    after,
    limit: Math.min(requestedLimit, maxLimit),
  }
}

export function readAssistantChangeCursor(url: URL) {
  const cursor = url.searchParams.get('cursor')
  if (cursor === null) return null
  if (!z.string().datetime({ offset: true }).safeParse(cursor).success) {
    throw new ApiError(400, 'Assistant change cursor must be an ISO timestamp')
  }
  return cursor
}

export function requirePart(parts: readonly string[], index: number) {
  const value = parts[index]
  if (!value) throw new ApiError(404, 'Route parameter is missing')
  return value
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status })
}

export function inlineContentDisposition(fileName: string) {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName).replaceAll("'", '%27')}`
}
