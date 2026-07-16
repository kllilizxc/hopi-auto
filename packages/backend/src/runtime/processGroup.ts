export async function terminateProcessGroup(pid: number) {
  if (!signalProcessGroup(pid, 0)) return
  signalProcessGroup(pid, 'SIGTERM')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Bun.sleep(50)
    if (!signalProcessGroup(pid, 0)) return
  }
  signalProcessGroup(pid, 'SIGKILL')
}

export function signalProcessGroup(pid: number, signal: 0 | NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

function isMissingProcess(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ESRCH'
  )
}
