import { describe, expect, test } from 'bun:test'
import {
  normalizeAgentAdapterConfig,
  resolveAssistantTransportConfig,
  resolveRoleTransportConfig,
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
