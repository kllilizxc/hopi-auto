async function terminateProcessGroup(pid: number) {
  assertValidProcessGroupPid(pid)
  try {
    await terminateTarget(-pid)
  } catch (error) {
    if (!isPermissionDenied(error)) throw error

    let fallbackError: unknown
    try {
      await terminateTarget(pid)
    } catch (caught) {
      fallbackError = caught
    }
    throw new ProcessGroupTerminationError(pid, error, fallbackError)
  }
}

export function createProcessGroupTerminator(pid: number) {
  let termination: Promise<void> | undefined
  return () => {
    if (!termination) {
      termination = terminateProcessGroup(pid)
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
