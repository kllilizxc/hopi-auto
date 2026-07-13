import {
  SUPPORTED_PLATFORMS,
  assertSupportedPlatform,
} from '../packages/backend/src/runtime/hostPlatform'

export const MINIMUM_BUN_VERSION = '1.3.11'
export const SUPPORTED_BUN_RANGE = `>=${MINIMUM_BUN_VERSION} <2`
export { SUPPORTED_PLATFORMS, assertSupportedPlatform }

function parseVersion(version: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (!match) {
    return null
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index]
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

export function assertSupportedBunVersion(actualVersion: string) {
  const actual = parseVersion(actualVersion)
  const minimum = parseVersion(MINIMUM_BUN_VERSION)
  if (!actual || !minimum || actual[0] >= 2 || compareVersions(actual, minimum) < 0) {
    throw new Error(
      `HOPI requires Bun ${SUPPORTED_BUN_RANGE}, but the current runtime is ${actualVersion}.`,
    )
  }
}

if (import.meta.main) {
  assertSupportedPlatform(process.platform)
  assertSupportedBunVersion(Bun.version)
}
