import { basename, extname, join } from 'node:path'
import { hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'

export const ASSISTANT_IMAGE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const
export const MAX_ASSISTANT_IMAGES = 4
export const MAX_ASSISTANT_IMAGE_BYTES = 10 * 1024 * 1024

export type AssistantImageMediaType = (typeof ASSISTANT_IMAGE_MEDIA_TYPES)[number]

export interface AssistantImageAttachment {
  reference: string
  absolutePath: string
  contentHash: string
  fileName: string
  mediaType: AssistantImageMediaType
  sizeBytes: number
}

export interface PreparedAssistantImages {
  attachments: AssistantImageAttachment[]
  writes: PublicationWrite[]
}

export class AssistantImageAttachmentError extends Error {}

export async function prepareAssistantImages(
  homeRoot: string,
  attachmentRoot: string,
  files: readonly File[],
): Promise<PreparedAssistantImages> {
  if (files.length > MAX_ASSISTANT_IMAGES) {
    throw new AssistantImageAttachmentError(
      `Too many images: at most ${MAX_ASSISTANT_IMAGES} are allowed per message.`,
    )
  }

  const attachments: AssistantImageAttachment[] = []
  const writes = new Map<string, PublicationWrite>()
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > MAX_ASSISTANT_IMAGE_BYTES) {
      throw new AssistantImageAttachmentError(
        `Image ${file.name || 'attachment'} exceeds the ${MAX_ASSISTANT_IMAGE_BYTES} byte limit.`,
      )
    }
    const mediaType = detectImageMediaType(bytes)
    if (!mediaType) {
      throw new AssistantImageAttachmentError(
        `Unsupported or invalid image: ${file.name || 'attachment'}.`,
      )
    }
    const contentHash = await hashBytes(bytes)
    const fileName = safeImageFileName(file.name, mediaType)
    const reference = `${attachmentRoot}/${contentHash}/${fileName}`
    const absolutePath = join(homeRoot, ...reference.split('/'))
    const existingFile = Bun.file(absolutePath)
    let expectedHash: string | null = null
    if (await existingFile.exists()) {
      const existing = new Uint8Array(await existingFile.arrayBuffer())
      expectedHash = await hashBytes(existing)
      if (expectedHash !== contentHash) {
        throw new AssistantImageAttachmentError(`Immutable image content mismatch: ${reference}`)
      }
    }
    writes.set(reference, { path: reference, expectedHash, content: bytes })
    if (!attachments.some((attachment) => attachment.reference === reference)) {
      attachments.push({
        reference,
        absolutePath,
        contentHash,
        fileName,
        mediaType,
        sizeBytes: bytes.byteLength,
      })
    }
  }

  return { attachments, writes: [...writes.values()] }
}

export async function resolveAssistantImage(
  homeRoot: string,
  attachmentRoot: string,
  reference: string,
): Promise<AssistantImageAttachment | null> {
  const identity = parseAssistantImageReference(attachmentRoot, reference)
  if (!identity) return null
  const absolutePath = join(homeRoot, ...reference.split('/'))
  const file = Bun.file(absolutePath)
  if (!(await file.exists())) {
    throw new AssistantImageAttachmentError(`Image attachment is missing: ${reference}`)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if ((await hashBytes(bytes)) !== identity.contentHash) {
    throw new AssistantImageAttachmentError(`Image attachment hash mismatch: ${reference}`)
  }
  const mediaType = detectImageMediaType(bytes)
  if (!mediaType) {
    throw new AssistantImageAttachmentError(`Image attachment is invalid: ${reference}`)
  }
  return {
    reference,
    absolutePath,
    contentHash: identity.contentHash,
    fileName: identity.fileName,
    mediaType,
    sizeBytes: bytes.byteLength,
  }
}

export function parseAssistantImageReference(attachmentRoot: string, reference: string) {
  const prefix = `${attachmentRoot}/`
  if (!reference.startsWith(prefix)) return null
  const parts = reference.slice(prefix.length).split('/')
  if (parts.length !== 2) return null
  const [contentHash, fileName] = parts
  if (!contentHash?.match(/^[a-f0-9]{64}$/) || !fileName?.match(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)) {
    return null
  }
  return { contentHash, fileName }
}

function detectImageMediaType(bytes: Uint8Array): AssistantImageMediaType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) {
    return 'image/gif'
  }
  return null
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end))
}

function safeImageFileName(fileName: string, mediaType: AssistantImageMediaType) {
  const base = basename(fileName || 'image').trim()
  const currentExtension = extname(base)
  const rawStem = base.slice(0, Math.max(0, base.length - currentExtension.length)) || 'image'
  const stem = rawStem
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 96)
  return `${stem || 'image'}${extensionFor(mediaType)}`
}

function extensionFor(mediaType: AssistantImageMediaType) {
  switch (mediaType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
  }
}
