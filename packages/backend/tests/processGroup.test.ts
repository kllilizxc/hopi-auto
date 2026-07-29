import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
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
  test('tracks a descendant that starts its own process group', async () => {
    const root = await mkdtemp('/tmp/hopi-process-tree-')
    const childPidFile = join(root, 'child.pid')
    const parent = Bun.spawn(
      [
        process.execPath,
        '-e',
        `const child=Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"],{stdin:"ignore",stdout:"ignore",stderr:"ignore",detached:true}); child.unref(); await Bun.write(${JSON.stringify(childPidFile)},String(child.pid)); await Bun.sleep(10000)`,
      ],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', detached: true },
    )
    const terminate = createProcessGroupTerminator(parent.pid, {
      trackDescendants: true,
      descendantPollMs: 10,
    })
    let childPid = 0

    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await Bun.file(childPidFile).exists()) {
          childPid = Number(await Bun.file(childPidFile).text())
          break
        }
        await Bun.sleep(10)
      }
      expect(childPid).toBeGreaterThan(0)
      await Bun.sleep(30)

      await terminate()
      await parent.exited

      expect(processExists(childPid)).toBe(false)
    } finally {
      await terminate().catch(() => undefined)
      if (childPid > 0) signalProcessGroup(childPid, 'SIGKILL')
      await rm(root, { recursive: true, force: true })
    }
  })

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

  test('accepts a denied final signal when the process group drains immediately after it', async () => {
    let denied = false
    const kill = spyOn(process, 'kill').mockImplementation(((pid, signal) => {
      if (pid > 0) throw systemError('ESRCH')
      if (signal === 'SIGKILL') {
        denied = true
        throw systemError('EPERM')
      }
      if (denied && signal === 0) throw systemError('ESRCH')
      return true
    }) as typeof process.kill)

    await expect(createProcessGroupTerminator(42)()).resolves.toBeUndefined()

    expect(kill).toHaveBeenCalledWith(-42, 'SIGKILL')
    expect(kill).not.toHaveBeenCalledWith(42, 0)
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

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
