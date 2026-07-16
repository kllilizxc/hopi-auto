import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test'
import { createProcessGroupTerminator, signalProcessGroup } from '../src/runtime/processGroup'

afterEach(() => {
  jest.restoreAllMocks()
})

test('signalling an already-exited process group is a successful no-op', async () => {
  const child = Bun.spawn(['bun', '-e', ''], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    detached: true,
  })
  expect(await child.exited).toBe(0)

  expect(signalProcessGroup(child.pid, 'SIGKILL')).toBe(false)
})

describe('process-group termination', () => {
  test('falls back to the group leader when final group escalation is denied', async () => {
    const signals: Array<[number, string | number | undefined]> = []
    const kill = spyOn(process, 'kill').mockImplementation(((pid, signal) => {
      signals.push([pid, signal])
      if (pid > 0) throw systemError('ESRCH')
      if (signal === 'SIGKILL') throw systemError('EPERM')
      return true
    }) as typeof process.kill)

    await expect(createProcessGroupTerminator(42)()).rejects.toThrow(
      'OS denied signaling process group 42',
    )

    expect(kill).toHaveBeenCalled()
    expect(signals[0]).toEqual([-42, 0])
    expect(signals).toContainEqual([-42, 'SIGTERM'])
    expect(signals).toContainEqual([-42, 'SIGKILL'])
    expect(signals.at(-1)).toEqual([42, 0])
  })

  test('shares one observed termination promise across concurrent cleanup triggers', async () => {
    const kill = spyOn(process, 'kill').mockImplementation((() => {
      throw systemError('EPERM')
    }) as typeof process.kill)
    const terminate = createProcessGroupTerminator(42)

    const first = terminate()
    await Bun.sleep(0)
    const second = terminate()

    expect(second).toBe(first)
    await expect(second).rejects.toThrow('OS denied signaling process group 42')
    expect(kill).toHaveBeenCalledTimes(2)
  })
})

function systemError(code: 'EPERM' | 'ESRCH') {
  return Object.assign(new Error(code), { code })
}
