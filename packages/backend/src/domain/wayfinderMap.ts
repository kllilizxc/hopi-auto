export const WAYFINDER_MAP_HEADINGS = [
  'Destination',
  'Notes',
  'Decisions so far',
  'Not yet specified',
  'Out of scope',
] as const

export class WayfinderMapError extends Error {}

export function assertWayfinderMap(markdown: string) {
  const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1])
  if (JSON.stringify(headings) !== JSON.stringify(WAYFINDER_MAP_HEADINGS)) {
    throw new WayfinderMapError(
      `Wayfinder Map must contain exactly these ordered headings: ${WAYFINDER_MAP_HEADINGS.join(', ')}`,
    )
  }
}
