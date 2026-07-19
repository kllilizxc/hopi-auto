export const DEFAULT_DIAGNOSTIC_TAIL_MAX_LINES = 200
export const DEFAULT_DIAGNOSTIC_TAIL_MAX_CHARACTERS = 64 * 1024

export class BoundedLineTail {
  private readonly lines: string[] = []
  private characters = 0

  constructor(
    private readonly maxLines = DEFAULT_DIAGNOSTIC_TAIL_MAX_LINES,
    private readonly maxCharacters = DEFAULT_DIAGNOSTIC_TAIL_MAX_CHARACTERS,
  ) {
    if (!Number.isInteger(maxLines) || maxLines < 1) {
      throw new Error('Diagnostic tail maxLines must be a positive integer')
    }
    if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
      throw new Error('Diagnostic tail maxCharacters must be a positive integer')
    }
  }

  push(line: string) {
    const retained =
      line.length <= this.maxCharacters
        ? line
        : this.maxCharacters === 1
          ? '…'
          : `…${line.slice(-(this.maxCharacters - 1))}`
    this.lines.push(retained)
    this.characters += retained.length
    while (this.lines.length > this.maxLines || this.characters > this.maxCharacters) {
      const removed = this.lines.shift()
      if (removed === undefined) break
      this.characters -= removed.length
    }
  }

  last() {
    return this.lines.at(-1)
  }

  values() {
    return [...this.lines]
  }

  text() {
    return this.lines.join('\n')
  }
}
