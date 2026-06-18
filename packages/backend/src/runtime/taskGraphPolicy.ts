import type { TaskItem, TodoBoard } from '../domain/board'

export interface TaskGraphDecompositionIssue {
  taskRefs: [string, string]
  sharedSurfaceHints: string[]
  message: string
}

export interface BrowserHarnessAcceptanceIssue {
  taskRef: string
  message: string
}

export function inspectEngineeringTaskDecomposition(
  board: TodoBoard,
): TaskGraphDecompositionIssue[] {
  const engineering = board.items.filter((task) => task.kind === 'engineering' && task.status !== 'done')
  const byRef = new Map(board.items.map((task) => [task.ref, task] as const))
  const issues: TaskGraphDecompositionIssue[] = []

  for (let index = 0; index < engineering.length; index += 1) {
    const left = engineering[index]
    if (!left) {
      continue
    }
    const leftHints = collectPrimarySurfaceHints(left)
    if (leftHints.length === 0) {
      continue
    }

    for (let offset = index + 1; offset < engineering.length; offset += 1) {
      const right = engineering[offset]
      if (!right) {
        continue
      }
      if (hasTaskDependencyPath(byRef, left.ref, right.ref) || hasTaskDependencyPath(byRef, right.ref, left.ref)) {
        continue
      }

      const overlap = intersectSurfaceHints(leftHints, collectPrimarySurfaceHints(right))
      if (overlap.length === 0) {
        continue
      }

      issues.push({
        taskRefs: [left.ref, right.ref],
        sharedSurfaceHints: overlap,
        message: `Engineering tasks ${left.ref} and ${right.ref} share primary surface hint(s) ${overlap.join(', ')} without a blockedBy task dependency.`,
      })
    }
  }

  return issues
}

const UI_RELATED_KEYWORDS = [
  'ui',
  'layout',
  'visual',
  'chrome',
  'pane',
  'modal',
  'button',
  'tab',
  'filter',
  'keyboard',
  'ime',
  'route',
  'browser',
  'screenshot',
  'responsive',
  'page',
  'panel',
  'form',
  'input',
  '界面',
  '布局',
  '视觉',
  '交互',
  '按钮',
  '弹窗',
  '面板',
  '截图',
  '浏览器',
  '键盘',
  '输入法',
  '响应式',
] as const

export function inspectBrowserHarnessAcceptanceCriteria(
  board: TodoBoard,
): BrowserHarnessAcceptanceIssue[] {
  return board.items
    .filter((task) => task.kind === 'engineering' && task.status !== 'done')
    .filter((task) => isUiOrE2eRelatedTask(task))
    .filter((task) => !hasBrowserHarnessAcceptance(task))
    .map((task) => ({
      taskRef: task.ref,
      message: `UI/e2e task ${task.ref} must include a Browser harness: acceptance criterion naming the scenario path or a credible not-applicable reason.`,
    }))
}

function isUiOrE2eRelatedTask(task: TaskItem) {
  const raw = `${task.title}\n${task.description}\n${task.acceptanceCriteria.join('\n')}`.toLowerCase()
  return UI_RELATED_KEYWORDS.some((keyword) => raw.includes(keyword.toLowerCase()))
}

function hasBrowserHarnessAcceptance(task: TaskItem) {
  return task.acceptanceCriteria.some((criterion) =>
    /^browser harness:\s*(?:.+|not applicable because .+)$/i.test(criterion.trim()),
  )
}

function collectPrimarySurfaceHints(task: TaskItem) {
  const raw = `${task.title}\n${task.description}\n${task.acceptanceCriteria.join('\n')}`
  const matches = raw.matchAll(/`([^`\n]+)`/g)
  const hints = new Set<string>()

  for (const match of matches) {
    const normalized = normalizePrimarySurfaceHint(match[1] ?? '')
    if (normalized) {
      hints.add(normalized)
    }
  }

  return [...hints]
}

function normalizePrimarySurfaceHint(value: string) {
  const trimmed = value.trim().replace(/^[.][/\\]/, '')
  if (trimmed.length < 4) {
    return null
  }

  if (looksLikeSourcePath(trimmed) || looksLikeCodeSurfaceIdentifier(trimmed)) {
    return trimmed.toLowerCase()
  }

  return null
}

function looksLikeSourcePath(value: string) {
  return /[\\/]/.test(value) || /\.(ts|tsx|js|jsx|css|scss|json)$/i.test(value)
}

function looksLikeCodeSurfaceIdentifier(value: string) {
  if (!/[A-Z]/.test(value) || /^[A-Z0-9_]+$/.test(value)) {
    return false
  }

  return /^[A-Za-z][A-Za-z0-9]+$/.test(value)
}

function intersectSurfaceHints(left: string[], right: string[]) {
  const rightSet = new Set(right)
  return left.filter((hint) => rightSet.has(hint))
}

function hasTaskDependencyPath(
  byRef: Map<string, TaskItem>,
  fromRef: string,
  targetRef: string,
  visited = new Set<string>(),
): boolean {
  if (fromRef === targetRef || visited.has(fromRef)) {
    return false
  }
  visited.add(fromRef)

  const task = byRef.get(fromRef)
  if (!task) {
    return false
  }

  for (const blocker of task.blockedBy) {
    if (blocker.kind !== 'task') {
      continue
    }
    if (blocker.ref === targetRef) {
      return true
    }
    if (hasTaskDependencyPath(byRef, blocker.ref, targetRef, visited)) {
      return true
    }
  }

  return false
}
