export const SUPPORTED_BUN_VERSION = '1.3.11'

export function assertSupportedBunVersion(actualVersion: string) {
  if (actualVersion !== SUPPORTED_BUN_VERSION) {
    throw new Error(
      `HOPI requires Bun ${SUPPORTED_BUN_VERSION}, but the current runtime is ${actualVersion}.`,
    )
  }
}

if (import.meta.main) {
  assertSupportedBunVersion(Bun.version)
}
