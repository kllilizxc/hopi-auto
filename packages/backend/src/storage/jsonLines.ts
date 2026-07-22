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
    const record = removeLegacyCrashPadding(line)
    if (!record.trim()) continue

    try {
      values.push(parse(JSON.parse(record)))
    } catch (error) {
      throw new Error(
        `Invalid durable JSONL record at ${path}:${index + 1}: ${errorMessage(error)}`,
      )
    }
  }

  return values
}

export async function repairDurableJsonLineTail(path: string): Promise<boolean> {
  const file = Bun.file(path)
  if (!(await file.exists())) return false

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0 || bytes[bytes.length - 1] === 0x0a) return false

  await truncate(path, bytes.lastIndexOf(0x0a) + 1)
  return true
}

function removeLegacyCrashPadding(line: string) {
  let offset = 0
  while (line.charCodeAt(offset) === 0) offset += 1
  return offset === 0 ? line : line.slice(offset)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
