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
        'POSIX path of (choose folder with prompt "Select project folder")',
      ]),
      'macOS directory chooser',
    )
  }

  if (platform === 'linux' && (env.WSL_DISTRO_NAME || env.WSL_INTEROP)) {
    const powershell = which('powershell.exe')
    const wslpath = which('wslpath')
    if (powershell && wslpath) {
      const initialDirectory = await translateWslPath(
        run,
        wslpath,
        '-w',
        resolve(env.HOME ?? '/'),
        'Cannot open the Windows directory chooser at WSL Home',
      )
      const selected = selectedPath(
        await run(modernWindowsFolderPickerCommand(powershell, initialDirectory)),
        'Windows directory chooser',
        false,
      )
      if (!selected) return null
      return resolve(
        await translateWslPath(
          run,
          wslpath,
          '-u',
          selected,
          'Cannot translate selected Windows directory',
        ),
      )
    }
  }

  if (platform === 'linux') {
    const zenity = which('zenity')
    if (zenity) {
      return selectedPath(
        await run([zenity, '--file-selection', '--directory', '--title=Select project folder']),
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

export function modernWindowsFolderPickerCommand(
  powershell: string,
  initialDirectory: string,
): string[] {
  const initialDirectoryBase64 = Buffer.from(initialDirectory, 'utf8').toString('base64')
  const script = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$initialDirectory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${initialDirectoryBase64}'))
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Flags]
internal enum FileOpenOptions : uint
{
    PickFolders = 0x00000020,
    ForceFileSystem = 0x00000040,
    PathMustExist = 0x00000800,
    DontAddToRecent = 0x02000000
}

internal enum ShellDisplayName : uint
{
    FileSystemPath = 0x80058000
}

[ComImport]
[Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellItem
{
    void BindToHandler(IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem parent);
    void GetDisplayName(ShellDisplayName displayName, out IntPtr name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem other, uint hint, out int order);
}

[ComImport]
[Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IFileDialog
{
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr filters);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(FileOpenOptions options);
    void GetOptions(out FileOpenOptions options);
    void SetDefaultFolder(IShellItem folder);
    void SetFolder(IShellItem folder);
    void GetFolder(out IShellItem folder);
    void GetCurrentSelection(out IShellItem selection);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
    void AddPlace(IShellItem item, uint alignment);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
    void Close(int result);
    void SetClientGuid([In] ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr filter);
}

public static class HopiFolderPicker
{
    private const int Cancelled = unchecked((int)0x800704C7);
    private static readonly Guid FileOpenDialogId = new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7");
    private static readonly Guid ShellItemId = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string path,
        IntPtr bindingContext,
        [In] ref Guid interfaceId,
        out IShellItem item);

    public static string Pick(string initialDirectory)
    {
        IFileDialog dialog = null;
        IShellItem initialFolder = null;
        IShellItem selectedFolder = null;
        IntPtr selectedName = IntPtr.Zero;
        try
        {
            dialog = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(FileOpenDialogId));
            FileOpenOptions options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | FileOpenOptions.PickFolders | FileOpenOptions.ForceFileSystem |
                FileOpenOptions.PathMustExist | FileOpenOptions.DontAddToRecent);
            dialog.SetTitle("Select project folder");
            dialog.SetOkButtonLabel("Use this folder");

            if (!String.IsNullOrWhiteSpace(initialDirectory) &&
                TryCreateShellItem(initialDirectory, out initialFolder))
            {
                try { dialog.SetFolder(initialFolder); }
                catch (COMException) { }
            }

            int result = dialog.Show(IntPtr.Zero);
            if (result == Cancelled) return null;
            Marshal.ThrowExceptionForHR(result);

            dialog.GetResult(out selectedFolder);
            selectedFolder.GetDisplayName(ShellDisplayName.FileSystemPath, out selectedName);
            return Marshal.PtrToStringUni(selectedName);
        }
        finally
        {
            if (selectedName != IntPtr.Zero) Marshal.FreeCoTaskMem(selectedName);
            if (selectedFolder != null) Marshal.FinalReleaseComObject(selectedFolder);
            if (initialFolder != null) Marshal.FinalReleaseComObject(initialFolder);
            if (dialog != null) Marshal.FinalReleaseComObject(dialog);
        }
    }

    private static bool TryCreateShellItem(string path, out IShellItem item)
    {
        Guid shellItemId = ShellItemId;
        return SHCreateItemFromParsingName(path, IntPtr.Zero, ref shellItemId, out item) >= 0;
    }
}
'@
$pickerMutex = New-Object Threading.Mutex($false, 'Local\\HOPI.ProjectFolderPicker')
$ownsPickerMutex = $false
$selectedDirectory = $null
try {
    try { $ownsPickerMutex = $pickerMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsPickerMutex = $true }
    if ($ownsPickerMutex) {
        $selectedDirectory = [HopiFolderPicker]::Pick($initialDirectory)
    }
}
finally {
    if ($ownsPickerMutex) { $pickerMutex.ReleaseMutex() }
    $pickerMutex.Dispose()
}
if ($null -ne $selectedDirectory) { [Console]::Out.Write($selectedDirectory) }
`.trim()

  return [
    powershell,
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ]
}

async function translateWslPath(
  run: NonNullable<HostDirectoryPickerOptions['run']>,
  wslpath: string,
  direction: '-u' | '-w',
  path: string,
  failureMessage: string,
) {
  const converted = await run([wslpath, direction, path])
  const value = converted.stdout.trim()
  if (converted.exitCode === 0 && value) return value
  throw new HostDirectoryPickerError(`${failureMessage}: ${converted.stderr.trim() || path}`)
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
