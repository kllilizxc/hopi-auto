import { rm } from 'node:fs/promises'
import type { AgentRuntimeEvent } from './runtimeEvents'
import {
  type NormalizeProcessOutputLineOptions,
  type ProcessTranscriptNormalizerState,
  createProcessTranscriptNormalizer,
} from './vendorTranscript'

export interface PersistentProcessTranscriptNormalizer {
  normalize(options: NormalizeProcessOutputLineOptions): Promise<AgentRuntimeEvent[]>
  unresolvedInfrastructureFailure(): string | null
}

export async function createPersistentProcessTranscriptNormalizer(options: {
  stateFile: string
  resumeState: boolean
}): Promise<PersistentProcessTranscriptNormalizer> {
  if (!options.resumeState) await rm(options.stateFile, { force: true })
  const normalizer = createProcessTranscriptNormalizer(
    options.resumeState ? await readJsonValue(options.stateFile) : undefined,
  )

  return {
    async normalize(input) {
      const previousStateRevision = normalizer.stateRevision()
      const events = normalizer.normalize(input)
      if (normalizer.stateRevision() !== previousStateRevision) {
        await writeState(options.stateFile, normalizer.state())
      }
      return events
    },
    unresolvedInfrastructureFailure() {
      return normalizer.unresolvedInfrastructureFailure()
    },
  }
}

async function readJsonValue(path: string): Promise<unknown> {
  const file = Bun.file(path)
  if (!(await file.exists())) return undefined
  try {
    return await file.json()
  } catch {
    return undefined
  }
}

async function writeState(path: string, state: ProcessTranscriptNormalizerState | null) {
  if (!state) {
    await rm(path, { force: true })
    return
  }
  await Bun.write(path, `${JSON.stringify(state, null, 2)}\n`)
}
