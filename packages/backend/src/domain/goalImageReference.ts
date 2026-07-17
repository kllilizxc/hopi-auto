const ASSISTANT_ATTACHMENT_PATH = '.hopi/docs/assistant/attachments/'
const IMAGE_EXTENSION = String.raw`(?:png|jpe?g|webp|gif)`
const FILE_URL_IMAGE = new RegExp(String.raw`file:\/\/[^\s)\]}>"'\x60]+\.${IMAGE_EXTENSION}`, 'i')
const HOME_RELATIVE_IMAGE = new RegExp(String.raw`~[\\/][^\s)\]}>"'\x60]+\.${IMAGE_EXTENSION}`, 'i')
const WINDOWS_IMAGE = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\s)\]}>"'\x60]+\.${IMAGE_EXTENSION}`,
  'i',
)
const POSIX_IMAGE = new RegExp(
  String.raw`\/(?:home|Users|root|tmp|var|private|mnt|Volumes|workspace)\/[^\s)\]}>"'\x60]+\.${IMAGE_EXTENSION}`,
  'i',
)

export function findNonPortableGoalImageReference(content: string) {
  if (content.includes(ASSISTANT_ATTACHMENT_PATH)) return ASSISTANT_ATTACHMENT_PATH
  return (
    content.match(FILE_URL_IMAGE)?.[0] ??
    content.match(HOME_RELATIVE_IMAGE)?.[0] ??
    content.match(WINDOWS_IMAGE)?.[0] ??
    content.match(POSIX_IMAGE)?.[0] ??
    null
  )
}
