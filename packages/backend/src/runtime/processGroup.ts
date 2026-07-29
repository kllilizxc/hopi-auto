async function terminateProcessGroup(pid: number) {
  assertValidProcessGroupPid(pid)
  try {
    await terminateTarget(-pid)
  } catch (error) {
    if (!isPermissionDenied(error)) throw error
    if (await observeTargetAbsent(-pid)) return

    let fallbackError: unknown
    try {
      await terminateTarget(pid)
    } catch (caught) {
      fallbackError = caught
    }
    throw new ProcessGroupTerminationError(pid, error, fallbackError)
  }
}

export interface ProcessGroupTerminatorOptions {
  trackDescendants?: boolean
  descendantPollMs?: number
}

export function createProcessGroupTerminator(
  pid: number,
  options: ProcessGroupTerminatorOptions = {},
) {
  assertValidProcessGroupPid(pid)
  let termination: Promise<void> | undefined
  const observedGroups = new Set([pid])
  let observation = Promise.resolve()
  const observe = () => {
    observation = observation
      .then(async () => {
        for (const group of await descendantProcessGroups(pid)) observedGroups.add(group)
      })
      .catch(() => undefined)
  }
  let interval: ReturnType<typeof setInterval> | undefined
  if (options.trackDescendants) {
    observe()
    interval = setInterval(observe, options.descendantPollMs ?? 100)
    interval.unref?.()
  }

  return () => {
    if (!termination) {
      if (interval) clearInterval(interval)
      termination = (async () => {
        if (options.trackDescendants) observe()
        await observation
        const groups = [...observedGroups].filter((group) => group !== pid)
        groups.push(pid)
        const results = await Promise.allSettled(groups.map(terminateProcessGroup))
        const failed = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        )
        if (failed) throw failed.reason
      })()
      void termination.catch(() => {})
    }
    return termination
  }
}

export function signalProcessGroup(pid: number, signal: 0 | NodeJS.Signals) {
  assertValidProcessGroupPid(pid)
  return signalProcess(-pid, signal)
}

async function terminateTarget(target: number) {
  if (!signalProcess(target, 0)) return
  signalProcess(target, 'SIGTERM')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Bun.sleep(50)
    if (!signalProcess(target, 0)) return
  }
  signalProcess(target, 'SIGKILL')
}

async function observeTargetAbsent(target: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await Bun.sleep(50)
    try {
      if (!signalProcess(target, 0)) return true
    } catch (error) {
      if (!isPermissionDenied(error)) throw error
    }
  }
  return false
}

function signalProcess(target: number, signal: 0 | NodeJS.Signals) {
  try {
    process.kill(target, signal)
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

function assertValidProcessGroupPid(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new RangeError(`Process-group leader PID must be a positive integer, received ${pid}`)
  }
}

async function descendantProcessGroups(rootPid: number) {
  if (process.platform === 'win32') return []
  const child = Bun.spawn(['ps', '-axo', 'pid=,ppid=,pgid='], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const [source, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (exitCode !== 0) return []

  const children = new Map<number, Array<{ pid: number; group: number }>>()
  for (const line of source.split(/\r?\n/)) {
    const [pidText, parentText, groupText] = line.trim().split(/\s+/)
    const pid = Number(pidText)
    const parent = Number(parentText)
    const group = Number(groupText)
    if (![pid, parent, group].every(Number.isSafeInteger) || pid <= 0 || group <= 0) continue
    const siblings = children.get(parent) ?? []
    siblings.push({ pid, group })
    children.set(parent, siblings)
  }

  const groups = new Set<number>()
  const visited = new Set([rootPid])
  const pending = [rootPid]
  while (pending.length > 0) {
    const parent = pending.pop()
    if (parent === undefined) break
    for (const descendant of children.get(parent) ?? []) {
      if (visited.has(descendant.pid)) continue
      visited.add(descendant.pid)
      pending.push(descendant.pid)
      groups.add(descendant.group)
    }
  }
  return [...groups]
}

function isMissingProcess(error: unknown) {
  return hasErrorCode(error, 'ESRCH')
}

function isPermissionDenied(error: unknown) {
  return hasErrorCode(error, 'EPERM')
}

function hasErrorCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

class ProcessGroupTerminationError extends Error {
  readonly code = 'EPERM'

  constructor(pid: number, groupError: unknown, fallbackError?: unknown) {
    super(
      fallbackError
        ? `OS denied signaling process group ${pid}; terminating its leader also failed`
        : `OS denied signaling process group ${pid}; its leader is no longer running but descendant cleanup cannot be guaranteed`,
      { cause: fallbackError ?? groupError },
    )
    this.name = 'ProcessGroupTerminationError'
  }
}
