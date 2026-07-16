import { posix, relative, resolve } from 'node:path'

export const ROOT_PROJECT_PATH = '.'

export function normalizeProjectPath(value: string | undefined): string {
  if (!value || value === ROOT_PROJECT_PATH) return ROOT_PROJECT_PATH
  if (value.includes('\\') || posix.isAbsolute(value)) {
    throw new Error(`Project path must be a relative POSIX path: ${value}`)
  }
  const normalized = posix.normalize(value)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Project path escapes its Git repository: ${value}`)
  }
  return normalized === '' ? ROOT_PROJECT_PATH : normalized
}

export function isNormalizedProjectPath(value: string): boolean {
  try {
    return normalizeProjectPath(value) === value
  } catch {
    return false
  }
}

export function storedProjectPath(value: string | undefined): string | undefined {
  const normalized = normalizeProjectPath(value)
  return normalized === ROOT_PROJECT_PATH ? undefined : normalized
}

export function scopedProjectPath(projectPath: string | undefined, relativePath: string): string {
  const scope = normalizeProjectPath(projectPath)
  const child = normalizeProjectPath(relativePath)
  if (child === ROOT_PROJECT_PATH) throw new Error('Project-relative file path cannot be empty')
  return scope === ROOT_PROJECT_PATH ? child : posix.join(scope, child)
}

export function resolveProjectPath(repoRoot: string, projectPath: string | undefined): string {
  const root = resolve(repoRoot)
  const target = resolve(root, ...normalizeProjectPath(projectPath).split('/'))
  const local = relative(root, target)
  if (local === '..' || local.startsWith(`..${posix.sep}`)) {
    throw new Error(`Project path escapes its Git repository: ${projectPath}`)
  }
  return target
}
