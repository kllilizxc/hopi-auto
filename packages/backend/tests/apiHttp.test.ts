import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  ApiError,
  inlineContentDisposition,
  parseBody,
  readAssistantChangeCursor,
  readPageRequest,
  requirePart,
} from '../src/api/http'

describe('API HTTP boundary', () => {
  test('parses typed JSON request bodies', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      body: JSON.stringify({ name: 'HOPI' }),
      headers: { 'content-type': 'application/json' },
    })

    await expect(parseBody(request, z.object({ name: z.string() }))).resolves.toEqual({
      name: 'HOPI',
    })
  })

  test('bounds cursor pages and rejects ambiguous navigation', () => {
    expect(readPageRequest(new URL('http://localhost/api/items?limit=500'), 20, 100)).toEqual({
      before: undefined,
      after: undefined,
      limit: 100,
    })
    expect(() =>
      readPageRequest(new URL('http://localhost/api/items?before=A&after=B'), 20, 100),
    ).toThrow('before and after are mutually exclusive')
    expect(() => readPageRequest(new URL('http://localhost/api/items?limit=0'), 20, 100)).toThrow(
      'limit must be a positive integer',
    )
  })

  test('validates incremental Assistant timestamps', () => {
    expect(
      readAssistantChangeCursor(
        new URL('http://localhost/api/assistant/feed/changes?cursor=2026-07-30T10:00:00Z'),
      ),
    ).toBe('2026-07-30T10:00:00Z')
    expect(() =>
      readAssistantChangeCursor(
        new URL('http://localhost/api/assistant/feed/changes?cursor=yesterday'),
      ),
    ).toThrow('Assistant change cursor must be an ISO timestamp')
  })

  test('reports missing path parameters through the API error contract', () => {
    expect(requirePart(['api', 'projects', 'P-1'], 2)).toBe('P-1')
    try {
      requirePart(['api', 'projects'], 2)
      throw new Error('Expected missing parameter error')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status: 404 })
    }
  })

  test('encodes inline artifact names without allowing header delimiters', () => {
    expect(inlineContentDisposition("report'; filename=unsafe.md")).toBe(
      "inline; filename*=UTF-8''report%27%3B%20filename%3Dunsafe.md",
    )
  })
})
