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
    if (!line.trim()) continue
    if (!hasTerminatedTail && index === lines.length - 1) break

    try {
      values.push(parse(JSON.parse(line)))
    } catch (error) {
      throw new Error(
        `Invalid durable JSONL record at ${path}:${index + 1}: ${errorMessage(error)}`,
      )
    }
  }

  return values
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
