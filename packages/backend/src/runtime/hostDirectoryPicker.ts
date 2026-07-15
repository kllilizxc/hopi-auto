import { resolve } from 'node:path'

interface PickerCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface HostDirectoryPickerOptions {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  which?: (binary: string) => string | null
  run?: (command: string[]) => Promise<PickerCommandResult>
}

export class HostDirectoryPickerError extends Error {}

export async function selectHostDirectory(
  options: HostDirectoryPickerOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const which = options.which ?? ((binary) => Bun.which(binary))
  const run = options.run ?? runCommand

  if (platform === 'darwin') {
    const osascript = which('osascript')
    if (!osascript) throw unavailable('osascript')
    return selectedPath(
      await run([
        osascript,
        '-e',
        'POSIX path of (choose folder with prompt "Select Git repository")',
      ]),
      'macOS directory chooser',
    )
  }

  if (platform === 'linux' && (env.WSL_DISTRO_NAME || env.WSL_INTEROP)) {
    const powershell = which('powershell.exe')
    const wslpath = which('wslpath')
    if (powershell && wslpath) {
      const selected = selectedPath(
        await run([
          powershell,
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            'Add-Type -AssemblyName System.Windows.Forms',
            '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
            '$dialog.Description = "Select Git repository"',
            'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }',
          ].join('; '),
        ]),
        'Windows directory chooser',
        false,
      )
      if (!selected) return null
      const converted = await run([wslpath, '-u', selected])
      if (converted.exitCode !== 0 || !converted.stdout.trim()) {
        throw new HostDirectoryPickerError(
          `Cannot translate selected Windows directory: ${converted.stderr.trim() || selected}`,
        )
      }
      return resolve(converted.stdout.trim())
    }
  }

  if (platform === 'linux') {
    const zenity = which('zenity')
    if (zenity) {
      return selectedPath(
        await run([zenity, '--file-selection', '--directory', '--title=Select Git repository']),
        'Linux directory chooser',
      )
    }
    const kdialog = which('kdialog')
    if (kdialog) {
      return selectedPath(
        await run([kdialog, '--getexistingdirectory', env.HOME ?? '/']),
        'Linux directory chooser',
      )
    }
    throw new HostDirectoryPickerError(
      'No system directory chooser is available. Install zenity or kdialog and retry.',
    )
  }

  throw new HostDirectoryPickerError(`System directory selection is unsupported on ${platform}`)
}

function selectedPath(result: PickerCommandResult, label: string, resolvePath = true) {
  const stdout = result.stdout.trim()
  if (result.exitCode === 0) return stdout ? (resolvePath ? resolve(stdout) : stdout) : null
  const stderr = result.stderr.trim()
  if ((result.exitCode === 1 && !stderr) || /user canceled|cancelled|\(-128\)/i.test(stderr)) {
    return null
  }
  throw new HostDirectoryPickerError(
    `${label} failed: ${stderr || stdout || `exit ${result.exitCode}`}`,
  )
}

function unavailable(binary: string) {
  return new HostDirectoryPickerError(`System directory chooser is unavailable: ${binary}`)
}

async function runCommand(command: string[]): Promise<PickerCommandResult> {
  const child = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
