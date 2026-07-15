import { describe, expect, test } from 'bun:test'
import { HostDirectoryPickerError, selectHostDirectory } from '../src/runtime/hostDirectoryPicker'

describe('selectHostDirectory', () => {
  test('uses the native Linux chooser and returns its selected directory', async () => {
    const commands: string[][] = []
    const selected = await selectHostDirectory({
      platform: 'linux',
      env: { HOME: '/home/test' },
      which: (binary) => (binary === 'zenity' ? '/usr/bin/zenity' : null),
      run: async (command) => {
        commands.push(command)
        return { exitCode: 0, stdout: '/home/test/project\n', stderr: '' }
      },
    })

    expect(selected).toBe('/home/test/project')
    expect(commands).toEqual([
      ['/usr/bin/zenity', '--file-selection', '--directory', '--title=Select Git repository'],
    ])
  })

  test('treats an empty chooser cancellation as no selection', async () => {
    await expect(
      selectHostDirectory({
        platform: 'darwin',
        which: () => '/usr/bin/osascript',
        run: async () => ({ exitCode: 1, stdout: '', stderr: 'User canceled. (-128)' }),
      }),
    ).resolves.toBeNull()
  })

  test('translates a Windows selection for a WSL Coordinator', async () => {
    const commands: string[][] = []
    const selected = await selectHostDirectory({
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Debian' },
      which: (binary) => `/bin/${binary}`,
      run: async (command) => {
        commands.push(command)
        return command[0]?.endsWith('powershell.exe')
          ? { exitCode: 0, stdout: 'C:\\Code\\product\r\n', stderr: '' }
          : { exitCode: 0, stdout: '/mnt/c/Code/product\n', stderr: '' }
      },
    })

    expect(selected).toBe('/mnt/c/Code/product')
    expect(commands.at(-1)).toEqual(['/bin/wslpath', '-u', 'C:\\Code\\product'])
  })

  test('fails with one actionable error when no host chooser exists', async () => {
    await expect(
      selectHostDirectory({ platform: 'linux', env: {}, which: () => null }),
    ).rejects.toBeInstanceOf(HostDirectoryPickerError)
  })
})
