import { appendFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BoardEvent, TodoBoard } from '../domain/board'
import { parseBoardYaml, stringifyBoardYaml, validateBoard } from '../domain/validation'
import { withFileLock } from './lock'
import { type ProjectPaths, createProjectPaths } from './paths'

export interface BoardStore {
  paths: ProjectPaths
  readBoard(goalKey: string): Promise<TodoBoard>
  mutateBoard(
    goalKey: string,
    writer: string,
    reason: string,
    mutate: (board: TodoBoard) => void,
  ): Promise<TodoBoard>
  appendEvent(goalKey: string, event: Omit<BoardEvent, 'id' | 'timestamp'>): Promise<BoardEvent>
}

export function createBoardStore(rootDir = process.cwd()): BoardStore {
  const paths = createProjectPaths(rootDir)

  return {
    paths,
    async readBoard(goalKey: string) {
      return readBoardAtPath(paths.todoPath(goalKey), goalKey)
    },
    async mutateBoard(goalKey: string, writer: string, reason: string, mutate) {
      await mkdir(paths.goalDir(goalKey), { recursive: true })

      return withFileLock(paths.lockPath(goalKey), async () => {
        const board = await readBoardAtPath(paths.todoPath(goalKey), goalKey)
        mutate(board)
        const nextBoard = validateBoard(board)
        await writeBoardAtomically(paths.todoPath(goalKey), nextBoard)
        await appendEventAtPath(paths.eventsPath(goalKey), {
          writer,
          action: 'board_mutated',
          goalKey,
          reason,
        })
        return nextBoard
      })
    },
    async appendEvent(goalKey: string, event) {
      await mkdir(paths.goalDir(goalKey), { recursive: true })
      return appendEventAtPath(paths.eventsPath(goalKey), event)
    },
  }
}

async function readBoardAtPath(todoPath: string, goalKey: string): Promise<TodoBoard> {
  const file = Bun.file(todoPath)
  if (!(await file.exists())) {
    return {
      version: 1,
      goal: { goalKey, title: `Goal: ${goalKey}` },
      items: [],
    }
  }

  return parseBoardYaml(await file.text())
}

async function writeBoardAtomically(todoPath: string, board: TodoBoard) {
  await mkdir(dirname(todoPath), { recursive: true })
  const tmpPath = `${todoPath}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, stringifyBoardYaml(board))
  await rename(tmpPath, todoPath)
}

async function appendEventAtPath(
  eventsPath: string,
  event: Omit<BoardEvent, 'id' | 'timestamp'>,
): Promise<BoardEvent> {
  await mkdir(dirname(eventsPath), { recursive: true })
  const fullEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...event,
  }

  await appendFile(eventsPath, `${JSON.stringify(fullEvent)}\n`, 'utf8')
  return fullEvent
}
