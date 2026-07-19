import { describe, expect, test } from 'bun:test'
import {
  normalizeAgentAdapterConfig,
  readAgentRoleCodingDefaults,
  readAssistantCodingDefaults,
  resolveAssistantTransportConfig,
  resolveRoleTransportConfig,
  updateAgentRoleCodingDefaults,
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

  test('preserves explicit legacy overrides while adding Home defaults', () => {
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

  test('uses Home defaults and explicit Home role overrides for workflow roles', () => {
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
    expect(resolveRoleTransportConfig(config, 'generator')).toMatchObject({
      transport: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    })
    expect(resolveRoleTransportConfig(config, 'reviewer')).toMatchObject({
      transport: 'claude',
      model: 'claude-review',
    })
    expect(resolveAssistantTransportConfig(config)).toMatchObject({
      transport: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
    })
  })

  test('inherits non-Codex Home defaults for Assistant and workflow roles', () => {
    const config = normalizeAgentAdapterConfig({
      version: 3,
      defaults: { transport: 'claude', model: 'claude-workflow' },
      roles: {},
    })

    expect(resolveAssistantTransportConfig(config)).toMatchObject({
      transport: 'claude',
      cwdMode: 'root',
      model: 'claude-workflow',
      permissionMode: 'dontAsk',
    })
    expect(resolveRoleTransportConfig(config, 'planner')).toMatchObject({
      transport: 'claude',
      model: 'claude-workflow',
    })
  })

  test('updates Assistant vendor and model without changing workflow defaults', () => {
    const config = normalizeAgentAdapterConfig({
      version: 3,
      defaults: { transport: 'codex', model: 'gpt-5.4', reasoningEffort: 'xhigh' },
      roles: {},
    })
    const overridden = updateAssistantCodingDefaults(config, {
      transport: 'opencode',
      model: 'anthropic/claude-sonnet-4-5',
    })

    expect(readAssistantCodingDefaults(overridden)).toEqual({
      codingDefaults: {
        transport: 'opencode',
        model: 'anthropic/claude-sonnet-4-5',
      },
      inherited: false,
    })
    expect(resolveRoleTransportConfig(overridden, 'planner')).toMatchObject({
      transport: 'codex',
      model: 'gpt-5.4',
    })
    expect(readAssistantCodingDefaults(updateAssistantCodingDefaults(overridden, null))).toEqual({
      codingDefaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      inherited: true,
    })
  })

  test('preserves compatible advanced Assistant fields while changing the model', () => {
    const config = normalizeAgentAdapterConfig({
      version: 3,
      defaults: { transport: 'codex', model: 'gpt-5.4', reasoningEffort: 'xhigh' },
      assistant: {
        transport: 'codex',
        cwdMode: 'root',
        binary: '/opt/codex',
        profile: 'team',
        sandbox: 'read-only',
        approvalPolicy: 'never',
      },
      roles: {},
    })

    expect(
      updateAssistantCodingDefaults(config, {
        transport: 'codex',
        model: 'gpt-5.5',
        reasoningEffort: 'high',
      }).assistant,
    ).toEqual({
      transport: 'codex',
      cwdMode: 'root',
      binary: '/opt/codex',
      profile: 'team',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    })
  })

  test('updates and clears one workflow role override without losing advanced fields', () => {
    const config = normalizeAgentAdapterConfig({
      version: 3,
      defaults: { transport: 'codex', model: 'gpt-5.4', reasoningEffort: 'xhigh' },
      roles: {
        reviewer: {
          transport: 'codex',
          cwdMode: 'worktree',
          binary: '/opt/codex',
          sandbox: 'read-only',
          approvalPolicy: 'never',
        },
      },
    })

    const overridden = updateAgentRoleCodingDefaults(config, 'reviewer', {
      transport: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    })
    expect(overridden.roles.reviewer).toEqual({
      transport: 'codex',
      cwdMode: 'worktree',
      binary: '/opt/codex',
      sandbox: 'read-only',
      approvalPolicy: 'never',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    })
    expect(readAgentRoleCodingDefaults(overridden, 'reviewer')).toEqual({
      codingDefaults: {
        transport: 'codex',
        model: 'gpt-5.5',
        reasoningEffort: 'high',
      },
      inherited: false,
      configurable: true,
    })
    expect(
      readAgentRoleCodingDefaults(
        updateAgentRoleCodingDefaults(overridden, 'reviewer', null),
        'reviewer',
      ),
    ).toEqual({
      codingDefaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      inherited: true,
      configurable: true,
    })
  })

  test('rejects process as an Assistant transport', () => {
    expect(() =>
      normalizeAgentAdapterConfig({
        version: 3,
        defaults: { transport: 'codex', model: 'gpt-5.4', reasoningEffort: 'xhigh' },
        assistant: {
          transport: 'process',
          cwdMode: 'root',
          cmd: ['bun', 'assistant.ts'],
        },
        roles: {},
      }),
    ).toThrow('assistant must use a built-in vendor transport')
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
