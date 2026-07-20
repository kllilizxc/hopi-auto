const KEY_PREFIX = 'hopi.project-agent-full-access.v1:'

export function readProjectAgentFullAccess(projectId: string, storage = browserStorage()) {
  if (!storage) return false
  try {
    return storage.getItem(storageKey(projectId)) === 'true'
  } catch {
    return false
  }
}

export function writeProjectAgentFullAccess(
  projectId: string,
  fullAccess: boolean,
  storage = browserStorage(),
) {
  if (!storage) return
  try {
    if (fullAccess) storage.setItem(storageKey(projectId), 'true')
    else storage.removeItem(storageKey(projectId))
  } catch {
    // The backend still receives the current choice; persistence is best-effort when storage is unavailable.
  }
}

function storageKey(projectId: string) {
  return `${KEY_PREFIX}${encodeURIComponent(projectId)}`
}

function browserStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage
}
