import { expect, test } from 'bun:test'
import { signalProcessGroup } from '../src/runtime/processGroup'

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
