export const SUPPORTED_PLATFORMS = ['darwin', 'linux'] as const

export function assertSupportedPlatform(actualPlatform: string) {
  if (!SUPPORTED_PLATFORMS.includes(actualPlatform as (typeof SUPPORTED_PLATFORMS)[number])) {
    throw new Error(
      `HOPI supports macOS, Linux, and WSL hosts; ${actualPlatform} is not supported. Run the Coordinator in WSL when using Windows.`,
    )
  }
}
