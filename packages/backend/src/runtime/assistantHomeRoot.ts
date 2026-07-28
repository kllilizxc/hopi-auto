import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export function defaultAssistantHomeRoot(
  env: { XDG_DATA_HOME?: string } = process.env as { XDG_DATA_HOME?: string },
  userHome = homedir(),
) {
  const dataRoot = env.XDG_DATA_HOME?.trim()
  return resolve(
    dataRoot && isAbsolute(dataRoot) ? dataRoot : join(userHome, '.local', 'share'),
    'hopi',
  )
}
