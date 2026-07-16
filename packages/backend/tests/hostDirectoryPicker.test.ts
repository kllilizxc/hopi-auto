import { describe, expect, test } from 'bun:test'
import {
  HostDirectoryPickerError,
  modernWindowsFolderPickerCommand,
  selectHostDirectory,
} from '../src/runtime/hostDirectoryPicker'

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
      ['/usr/bin/zenity', '--file-selection', '--directory', '--title=Select project folder'],
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
      env: { HOME: '/home/test', WSL_DISTRO_NAME: 'Debian' },
      which: (binary) => `/bin/${binary}`,
      run: async (command) => {
        commands.push(command)
        if (command.includes('-EncodedCommand')) {
          return { exitCode: 0, stdout: 'C:\\Code\\product\r\n', stderr: '' }
        }
        return command.includes('-w')
          ? {
              exitCode: 0,
              stdout: '\\\\wsl.localhost\\Debian\\home\\test\n',
              stderr: '',
            }
          : { exitCode: 0, stdout: '/mnt/c/Code/product\n', stderr: '' }
      },
    })

    expect(selected).toBe('/mnt/c/Code/product')
    expect(commands[0]).toEqual(['/bin/wslpath', '-w', '/home/test'])
    expect(commands[1]?.slice(0, -1)).toEqual([
      '/bin/powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-EncodedCommand',
    ])
    expect(commands.at(-1)).toEqual(['/bin/wslpath', '-u', 'C:\\Code\\product'])
  })

  test('builds the modern Explorer picker with a WSL Home initial folder', () => {
    const command = modernWindowsFolderPickerCommand(
      'powershell.exe',
      '\\\\wsl.localhost\\Debian\\home\\test user',
    )
    const encodedScript = command.at(-1)
    const script = Buffer.from(encodedScript ?? '', 'base64').toString('utf16le')

    expect(command.slice(0, -1)).toEqual([
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-EncodedCommand',
    ])
    expect(script).toContain('DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7')
    expect(script).toContain('FileOpenOptions.PickFolders')
    expect(script).toContain('Use this folder')
    expect(script).toContain('Local\\HOPI.ProjectFolderPicker')
    expect(script).toContain('$pickerMutex.WaitOne(0)')
    expect(script).toContain('Text.UTF8Encoding')
    expect(script).toContain(
      Buffer.from('\\\\wsl.localhost\\Debian\\home\\test user', 'utf8').toString('base64'),
    )
  })

  test('fails with one actionable error when no host chooser exists', async () => {
    await expect(
      selectHostDirectory({ platform: 'linux', env: {}, which: () => null }),
    ).rejects.toBeInstanceOf(HostDirectoryPickerError)
  })
})
