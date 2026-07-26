#!/usr/bin/env bun

import { join } from 'node:path'
import {
  BROWSER_TARGETS,
  type BrowserTarget,
  browserHarnessRuntimeRoot,
  browserHarnessStateRoot,
  ensureManagedBrowser,
  resolveBrowserHarnessBackendCommand,
} from './runtime/browserEnvironment'

const parsed = parseTarget(Bun.argv.slice(2))
const homeRoot = process.env.HOPI_BROWSER_HOME?.trim()
if (!homeRoot) {
  throw new Error('HOPI_BROWSER_HOME is required')
}
const backendCommand =
  process.env.HOPI_BROWSER_HARNESS_BACKEND_COMMAND?.trim() || resolveBrowserHarnessBackendCommand()
if (!backendCommand) {
  throw new Error('Browser Harness is not installed')
}

const commonEnvironment = {
  ...process.env,
  BH_RUNTIME_DIR: browserHarnessRuntimeRoot(homeRoot),
  BH_RUNTIME_DIR_SHARED: '1',
  BH_TMP_DIR: join(browserHarnessStateRoot(homeRoot), 'logs'),
  BH_TMP_DIR_SHARED: '1',
}
const targetEnvironment =
  parsed.target === 'managed'
    ? {
        BU_NAME: 'hopi-managed',
        BU_CDP_URL: (await ensureManagedBrowser(homeRoot)).httpUrl,
        BU_CDP_WS: undefined,
        BU_BROWSER_ID: undefined,
      }
    : {
        BU_NAME: 'hopi-operator',
        BU_CDP_URL: undefined,
        BU_CDP_WS: undefined,
        BU_BROWSER_ID: undefined,
      }

const child = Bun.spawn([backendCommand, ...parsed.args], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...commonEnvironment, ...targetEnvironment },
})
process.exit(await child.exited)

function parseTarget(args: string[]): { target: BrowserTarget; args: string[] } {
  const remaining = [...args]
  let rawTarget = process.env.HOPI_BROWSER_TARGET?.trim() || 'managed'
  if (remaining[0] === '--target') {
    rawTarget = remaining[1] ?? ''
    remaining.splice(0, 2)
  } else if (remaining[0]?.startsWith('--target=')) {
    rawTarget = remaining[0].slice('--target='.length)
    remaining.shift()
  }
  if (!BROWSER_TARGETS.includes(rawTarget as BrowserTarget)) {
    throw new Error(
      `Invalid browser target ${JSON.stringify(rawTarget)}; expected ${BROWSER_TARGETS.join(' or ')}`,
    )
  }
  return { target: rawTarget as BrowserTarget, args: remaining }
}
