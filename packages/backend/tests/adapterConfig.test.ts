import { describe, expect, test } from 'bun:test'
import {
  normalizeAgentAdapterConfig,
  readAgentCodingSettings,
  resolveAssistantTransportConfig,
  resolveWorkerTransportConfig,
  updateAgentCodingSettings,
} from '../src/agent/adapterConfig'

describe('agent adapter config', () => {
  test('accepts Codex max reasoning without coupling it to a specific model name', () => {
    expect(
      normalizeAgentAdapterConfig({
        defaults: { transport: 'codex', model: 'gpt-5.6', reasoningEffort: 'max' },
      }).defaults,
    ).toEqual({ transport: 'codex', model: 'gpt-5.6', reasoningEffort: 'max' })
  })

  test('has only Assistant and Worker configuration', () => {
    const config = normalizeAgentAdapterConfig({
      defaults: { transport: 'codex', model: 'gpt-5.6', reasoningEffort: 'xhigh' },
    })

    expect(resolveAssistantTransportConfig(config)).toMatchObject({
      transport: 'codex',
      cwdMode: 'root',
      model: 'gpt-5.6',
    })
    expect(resolveWorkerTransportConfig(config)).toMatchObject({
      transport: 'codex',
      cwdMode: 'worktree',
      model: 'gpt-5.6',
    })
    expect(() => normalizeAgentAdapterConfig({ ...config, roles: {} })).toThrow('roles')
  })

  test('updates one agent without creating semantic role configuration', () => {
    const config = normalizeAgentAdapterConfig({
      defaults: { transport: 'codex', model: 'gpt-5.6', reasoningEffort: 'high' },
    })
    const changed = updateAgentCodingSettings(config, 'worker', {
      transport: 'claude',
      model: 'claude-sonnet',
    })

    expect(readAgentCodingSettings(changed, 'worker')).toMatchObject({
      codingDefaults: { transport: 'claude', model: 'claude-sonnet' },
      inherited: false,
      configurable: true,
    })
    expect(readAgentCodingSettings(changed, 'assistant').inherited).toBeTrue()
    expect(updateAgentCodingSettings(changed, 'worker', null)).not.toHaveProperty('worker')
  })

  test('rejects process for Assistant and permits it for Worker', () => {
    const process = {
      cmd: ['worker-adapter'],
      cwdMode: 'worktree',
    } as const
    expect(() =>
      normalizeAgentAdapterConfig({
        defaults: { transport: 'codex', model: 'gpt-5.6', reasoningEffort: 'high' },
        assistant: process,
      }),
    ).toThrow('assistant')
    expect(() =>
      normalizeAgentAdapterConfig({
        defaults: { transport: 'codex', model: 'gpt-5.6', reasoningEffort: 'high' },
        worker: process,
      }),
    ).not.toThrow()
  })
})
