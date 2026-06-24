import { describe, expect, test } from 'bun:test'
import {
  assistantRuntimeEventToFeedItem,
  matchGoalRoute,
  numberQuery,
  parseAssistantImageEntries,
  roleQuery,
  stringQuery,
} from '../src/serverSupport'

describe('serverSupport', () => {
  test('matches both legacy and project-scoped goal routes', () => {
    expect(matchGoalRoute(['api', 'goals', 'goal-1', 'board'])).toEqual({
      goalKey: 'goal-1',
      leaf: 'board',
      extra: [],
    })

    expect(
      matchGoalRoute(['api', 'projects', 'project-1', 'goals', 'goal-1', 'assistant', 'feed']),
    ).toEqual({
      projectKey: 'project-1',
      goalKey: 'goal-1',
      leaf: 'assistant',
      extra: ['feed'],
    })
  })

  test('reads string, numeric, and role query parameters with validation', () => {
    const url = new URL(
      'http://localhost/api/goals/goal-1/write-traces?before=cursor-1&limit=25&role=reviewer',
    )

    expect(stringQuery(url, 'before')).toBe('cursor-1')
    expect(numberQuery(url, 'limit')).toBe(25)
    expect(roleQuery(url)).toBe('reviewer')

    expect(() => numberQuery(new URL('http://localhost?limit=0'), 'limit')).toThrow(
      'Invalid query parameter: limit',
    )
    expect(() => roleQuery(new URL('http://localhost?role=janitor'))).toThrow(
      'Invalid query parameter: role',
    )
  })

  test('accepts only file-based assistant image uploads', () => {
    const validFormData = new FormData()
    validFormData.append('images', new File(['image-bytes'], 'diagram.png', { type: 'image/png' }))

    const invalidFormData = new FormData()
    invalidFormData.append('images', 'not-a-file')

    expect(parseAssistantImageEntries(validFormData)).toHaveLength(1)
    expect(() => parseAssistantImageEntries(invalidFormData)).toThrow('Invalid request body')
  })

  test('maps visible assistant runtime events into feed items and drops hidden ones', () => {
    expect(
      assistantRuntimeEventToFeedItem('assistant-run-1', {
        kind: 'message',
        level: 'info',
        role: 'assistant',
        content: 'Planner is waiting on a decision.',
      }),
    ).toMatchObject({
      kind: 'system_message',
      role: 'system',
      text: 'Planner is waiting on a decision.',
      label: 'Assistant info',
    })

    expect(
      assistantRuntimeEventToFeedItem('assistant-run-1', {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'status',
        summary: 'turn started',
      }),
    ).toBeNull()

    expect(
      assistantRuntimeEventToFeedItem('assistant-run-1', {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_call',
        summary: 'read_file src/server.ts',
        toolName: 'read_file',
        vendorEventType: 'command_execution.started',
      }),
    ).toMatchObject({
      kind: 'tool_call',
      role: 'system',
      text: 'read_file src/server.ts',
      label: 'Tool call',
      toolName: 'read_file',
      transport: 'codex',
      vendorEventType: 'command_execution.started',
    })
  })
})
