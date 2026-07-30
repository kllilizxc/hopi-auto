import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeTextAtomically(path: string, content: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp.${crypto.randomUUID()}`
  try {
    await Bun.write(temporaryPath, content)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function writeJsonAtomically(path: string, value: unknown) {
  await writeTextAtomically(path, `${JSON.stringify(value, null, 2)}\n`)
}
