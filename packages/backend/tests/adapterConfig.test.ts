import { describe, expect, test } from 'bun:test'
import {
  normalizeAgentAdapterConfig,
  readAssistantCodingDefaults,
  resolveAssistantTransportConfig,
  resolveRoleTransportConfig,
  updateAssistantCodingDefaults,
} from '../src/agent/adapterConfig'

describe('agent adapter config normalization', () => {
  test('migrates legacy generated codex defaults into a defaults-only v3 config', () => {
    expect(
      normalizeAgentAdapterConfig({
        version: 2,
        assistant: {
          transport: 'codex',
          cwdMode: 'root',
          sandbox: 'workspace-write',
          approvalPolicy: 'never',
        },
        roles: {
          planner: {
            transport: 'codex',
            cwdMode: 'worktree',
            sandbox: 'workspace-write',
            approvalPolicy: 'never',
          },
          generator: {
            transport: 'codex',
            cwdMode: 'worktree',
            sandbox: 'workspace-write',
            approvalPolicy: 'never',
          },
          reviewer: {
            transport: 'codex',
            cwdMode: 'worktree',
            sandbox: 'workspace-write',
            approvalPolicy: 'never',
          },
          merger: {
            transport: 'codex',
            cwdMode: 'worktree',
            sandbox: 'workspace-write',
            approvalPolicy: 'never',
          },
        },
      }),
    ).toEqual({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      roles: {},
    })
  })

  test('preserves explicit legacy overrides while adding project defaults', () => {
    expect(
      normalizeAgentAdapterConfig({
        version: 1,
        roles: {
          reviewer: {
            cmd: ['bun', '-e', 'console.log("review")'],
            cwdMode: 'root',
          },
        },
      }),
    ).toEqual({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      roles: {
        reviewer: {
          cmd: ['bun', '-e', 'console.log("review")'],
          cwdMode: 'worktree',
        },
      },
    })
  })

  test('resolves defaults-only configs for assistant and workflow roles', () => {
    const config = normalizeAgentAdapterConfig({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      roles: {},
    })

    expect(resolveAssistantTransportConfig(config)).toEqual({
      transport: 'codex',
      cwdMode: 'root',
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    })
    expect(resolveRoleTransportConfig(config, 'generator')).toEqual({
      transport: 'codex',
      cwdMode: 'worktree',
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    })
  })

  test('uses Project defaults for workflow roles without changing the workspace Assistant', () => {
    const config = normalizeAgentAdapterConfig({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      roles: {
        reviewer: {
          transport: 'claude',
          cwdMode: 'worktree',
          model: 'claude-review',
          permissionMode: 'dontAsk',
        },
      },
    })
    const projectDefaults = {
      transport: 'codex' as const,
      model: 'gpt-5.3-codex',
      reasoningEffort: 'high' as const,
    }

    expect(resolveRoleTransportConfig(config, 'generator', projectDefaults)).toMatchObject({
      transport: 'codex',
      model: 'gpt-5.3-codex',
      reasoningEffort: 'high',
    })
    expect(resolveRoleTransportConfig(config, 'reviewer', projectDefaults)).toMatchObject({
      transport: 'claude',
      model: 'claude-review',
    })
    expect(resolveAssistantTransportConfig(config)).toMatchObject({
      transport: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    })
  })

  test('applies and clears an Assistant-only model override without changing role defaults', () => {
    const config = normalizeAgentAdapterConfig({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      roles: {},
    })
    const overridden = updateAssistantCodingDefaults(config, {
      transport: 'opencode',
      model: 'gemini-proxy/gemini-3.1-pro-preview',
    })

    expect(readAssistantCodingDefaults(overridden)).toEqual({
      codingDefaults: {
        transport: 'opencode',
        model: 'gemini-proxy/gemini-3.1-pro-preview',
      },
      inherited: false,
    })
    expect(resolveAssistantTransportConfig(overridden)).toMatchObject({
      transport: 'opencode',
      cwdMode: 'root',
      model: 'gemini-proxy/gemini-3.1-pro-preview',
    })
    expect(resolveRoleTransportConfig(overridden, 'planner')).toMatchObject({
      transport: 'codex',
      model: 'gpt-5.4',
    })

    const cleared = updateAssistantCodingDefaults(overridden, null)
    expect(readAssistantCodingDefaults(cleared)).toMatchObject({
      codingDefaults: { transport: 'codex', model: 'gpt-5.4' },
      inherited: true,
    })
  })

  test('uses autonomous edit mode for generated Claude defaults without bypassing permissions', () => {
    const config = normalizeAgentAdapterConfig({
      version: 3,
      defaults: { transport: 'claude', model: 'sonnet' },
      roles: {},
    })

    expect(resolveAssistantTransportConfig(config)).toEqual({
      transport: 'claude',
      cwdMode: 'root',
      model: 'sonnet',
      permissionMode: 'acceptEdits',
    })
    expect(resolveRoleTransportConfig(config, 'generator')).toEqual({
      transport: 'claude',
      cwdMode: 'worktree',
      model: 'sonnet',
      permissionMode: 'acceptEdits',
    })
  })

  test('lets explicit codex overrides inherit model and effort unless a profile is set', () => {
    const inheritedConfig = normalizeAgentAdapterConfig({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      assistant: {
        transport: 'codex',
        cwdMode: 'root',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      },
      roles: {},
    })
    const profiledConfig = normalizeAgentAdapterConfig({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      assistant: {
        transport: 'codex',
        cwdMode: 'root',
        profile: 'team-default',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
      },
      roles: {},
    })

    expect(resolveAssistantTransportConfig(inheritedConfig)).toMatchObject({
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    })
    expect(resolveAssistantTransportConfig(profiledConfig)).toMatchObject({
      profile: 'team-default',
    })
    expect(resolveAssistantTransportConfig(profiledConfig)).not.toHaveProperty('model')
    expect(resolveAssistantTransportConfig(profiledConfig)).not.toHaveProperty('reasoningEffort')
  })
})
