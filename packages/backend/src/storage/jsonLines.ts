import { truncate } from 'node:fs/promises'

export async function readDurableJsonLines<T>(
  path: string,
  parse: (value: unknown) => T,
): Promise<T[]> {
  const file = Bun.file(path)
  if (!(await file.exists())) return []

  const source = await file.text()
  const lines = source.split(/\r?\n/)
  const hasTerminatedTail = source.endsWith('\n')
  const values: T[] = []

  for (const [index, line] of lines.entries()) {
    if (!hasTerminatedTail && index === lines.length - 1) break
    if (!line.trim()) continue

    try {
      values.push(parse(JSON.parse(line)))
    } catch (error) {
      reportInvalidRuntimeRecord(`${path}:${index + 1}`, error)
    }
  }

  return values
}

export function reportInvalidRuntimeRecord(path: string, error: unknown) {
  console.warn(`[hopi ignored corrupt runtime record] ${path}: ${errorMessage(error)}`)
}

export async function repairDurableJsonLineTail(path: string): Promise<boolean> {
  const file = Bun.file(path)
  if (!(await file.exists())) return false

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0 || bytes[bytes.length - 1] === 0x0a) return false

  await truncate(path, bytes.lastIndexOf(0x0a) + 1)
  return true
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
