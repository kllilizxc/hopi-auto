import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createProjectPaths } from '../storage/paths'

export interface GoalDocsFiles {
  goalFile: string
  designFile: string
}

export type GoalDocStatus = 'bootstrapped' | 'curated'

export interface GoalDocSnapshot {
  path: string
  content: string
  status: GoalDocStatus
}

export interface GoalDocsSnapshot {
  goalKey: string
  goal: GoalDocSnapshot
  design: GoalDocSnapshot
}

export interface GoalDocsStore {
  ensureGoalDocs(goalKey: string, goalTitle: string): Promise<GoalDocsFiles>
  readGoalDocs(goalKey: string, goalTitle: string): Promise<GoalDocsSnapshot>
}

export function createGoalDocsStore(rootDir = process.cwd()): GoalDocsStore {
  const paths = createProjectPaths(rootDir)

  return {
    async ensureGoalDocs(goalKey, goalTitle) {
      const goalFile = paths.goalMarkdownPath(goalKey)
      const designFile = paths.designMarkdownPath(goalKey)

      await writeIfMissing(goalFile, renderGoalMarkdown(goalKey, goalTitle))
      await writeIfMissing(designFile, renderDesignMarkdown(goalTitle))

      return {
        goalFile,
        designFile,
      }
    },
    async readGoalDocs(goalKey, goalTitle) {
      const files = await this.ensureGoalDocs(goalKey, goalTitle)
      const goalContent = await Bun.file(files.goalFile).text()
      const designContent = await Bun.file(files.designFile).text()

      return {
        goalKey,
        goal: {
          path: files.goalFile,
          content: goalContent,
          status:
            goalContent === renderGoalMarkdown(goalKey, goalTitle) ? 'bootstrapped' : 'curated',
        },
        design: {
          path: files.designFile,
          content: designContent,
          status: designContent === renderDesignMarkdown(goalTitle) ? 'bootstrapped' : 'curated',
        },
      }
    },
  }
}

async function writeIfMissing(path: string, content: string) {
  const file = Bun.file(path)
  if (await file.exists()) {
    return
  }

  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, content)
}

function renderGoalMarkdown(goalKey: string, goalTitle: string) {
  return `# ${goalTitle}

- Goal Key: ${goalKey}
- Objective: capture and complete this Goal through the HOPI workflow.
- Success Criteria: not yet recorded in durable Goal docs.
- Current Strategy: bootstrap durable Goal context for runtime adapters.
- Open Questions: none recorded yet.
`
}

function renderDesignMarkdown(goalTitle: string) {
  return `# Design: ${goalTitle}

## Problem

Durable design detail has not been recorded yet.

## Goals

- Record the long-term design rationale for this Goal.

## Non-Goals

- This bootstrap file does not claim the design is complete.

## User / Workflow

Not yet recorded.

## Architecture

Not yet recorded.

## Data Model

Not yet recorded.

## Edge Cases

Not yet recorded.

## Testing / Acceptance

Not yet recorded.

## Open Questions

- Planner should replace this bootstrap content with real design detail.
`
}
