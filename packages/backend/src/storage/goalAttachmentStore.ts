import { mkdir } from 'node:fs/promises'
import { basename, dirname, extname, posix as pathPosix, relative, resolve } from 'node:path'
import { z } from 'zod'
import { createProjectPaths } from './paths'

export const GOAL_ATTACHMENT_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const
export const MAX_ASSISTANT_IMAGE_ATTACHMENTS = 4
export const MAX_ASSISTANT_IMAGE_SIZE_BYTES = 10 * 1024 * 1024

export type GoalAttachmentMediaType = (typeof GOAL_ATTACHMENT_MEDIA_TYPES)[number]

export interface GoalAttachmentRef {
  assetPath: string
  fileName: string
  mediaType: GoalAttachmentMediaType
  sizeBytes: number
  createdAt: string
}

export class GoalAttachmentStoreError extends Error {}

export const goalAttachmentRefSchema = z.object({
  assetPath: z
    .string()
    .min(1)
    .transform((value) => normalizeGoalAttachmentAssetPath(value)),
  fileName: z.string().min(1),
  mediaType: z.enum(GOAL_ATTACHMENT_MEDIA_TYPES),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
})

export const goalAttachmentRefArraySchema = z
  .array(goalAttachmentRefSchema)
  .default([])
  .transform((values) => mergeGoalAttachmentRefs([], values))

export interface GoalAttachmentStore {
  persistAssistantImages(goalKey: string, files: File[]): Promise<GoalAttachmentRef[]>
  resolveGoalAttachments(
    goalKey: string,
    attachments: GoalAttachmentRef[],
  ): Promise<GoalAttachmentRef[]>
  resolveGoalAsset(goalKey: string, assetPathWithinAssetsRoot: string): {
    assetPath: string
    absolutePath: string
  }
}

export function createGoalAttachmentStore(rootDir = process.cwd()): GoalAttachmentStore {
  const paths = createProjectPaths(rootDir)

  return {
    async persistAssistantImages(goalKey, files) {
      validateAssistantImages(files)
      const createdAt = new Date().toISOString()
      const attachments: GoalAttachmentRef[] = []

      for (const file of files) {
        validateAssistantImageFile(file)
        const fileName = sanitizeGoalAttachmentFileName(file.name, file.type)
        const assetPath = normalizeGoalAttachmentAssetPath(
          `assets/assistant/${crypto.randomUUID()}/${fileName}`,
        )
        const absolutePath = paths.goalAssetPath(goalKey, assetPath)
        await mkdir(dirname(absolutePath), { recursive: true })
        await Bun.write(absolutePath, file)
        attachments.push({
          assetPath,
          fileName,
          mediaType: file.type as GoalAttachmentMediaType,
          sizeBytes: file.size,
          createdAt,
        })
      }

      return attachments
    },
    async resolveGoalAttachments(goalKey, attachments) {
      const normalized = mergeGoalAttachmentRefs([], attachments)
      for (const attachment of normalized) {
        const resolved = this.resolveGoalAsset(
          goalKey,
          attachment.assetPath.slice('assets/'.length),
        )
        if (!(await Bun.file(resolved.absolutePath).exists())) {
          throw new GoalAttachmentStoreError(
            `Goal asset not found: ${attachment.assetPath}`,
          )
        }
      }
      return normalized
    },
    resolveGoalAsset(goalKey, assetPathWithinAssetsRoot) {
      const normalizedWithinAssets = normalizeGoalAssetSubPath(assetPathWithinAssetsRoot)
      const assetPath = normalizeGoalAttachmentAssetPath(`assets/${normalizedWithinAssets}`)
      const absolutePath = resolve(paths.goalAssetPath(goalKey, assetPath))
      const assetsRoot = resolve(paths.goalAssetsDir(goalKey))
      const relativeToAssetsRoot = relative(assetsRoot, absolutePath)
      if (
        relativeToAssetsRoot === '' ||
        relativeToAssetsRoot.startsWith('..') ||
        relativeToAssetsRoot.includes('/../') ||
        relativeToAssetsRoot.includes('\\..\\')
      ) {
        throw new GoalAttachmentStoreError(`Invalid Goal asset path: ${assetPathWithinAssetsRoot}`)
      }

      return {
        assetPath,
        absolutePath,
      }
    },
  }
}

export function mergeGoalAttachmentRefs(
  existing: GoalAttachmentRef[],
  incoming: GoalAttachmentRef[],
): GoalAttachmentRef[] {
  const merged = [...existing]
  const seen = new Set(existing.map((attachment) => attachment.assetPath))
  for (const attachment of incoming) {
    const normalized = {
      ...attachment,
      assetPath: normalizeGoalAttachmentAssetPath(attachment.assetPath),
      fileName: attachment.fileName.trim(),
    }
    if (seen.has(normalized.assetPath)) {
      continue
    }
    merged.push(normalized)
    seen.add(normalized.assetPath)
  }
  return merged
}

export function normalizeGoalAttachmentAssetPath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new GoalAttachmentStoreError('Invalid Goal attachment asset path: path is required')
  }

  const normalized = normalizeRelativePath(trimmed)
  if (!normalized.startsWith('assets/')) {
    throw new GoalAttachmentStoreError(
      'Invalid Goal attachment asset path: path must stay within Goal assets/',
    )
  }
  return normalized
}

function normalizeGoalAssetSubPath(value: string) {
  const normalized = normalizeRelativePath(value)
  if (!normalized || normalized === 'assets') {
    throw new GoalAttachmentStoreError('Invalid Goal asset path: path is required')
  }
  return normalized
}

function normalizeRelativePath(value: string) {
  const slashNormalized = value.replaceAll('\\', '/')
  if (slashNormalized.startsWith('/')) {
    throw new GoalAttachmentStoreError('Invalid Goal asset path: absolute paths are not allowed')
  }

  if (slashNormalized.split('/').some((segment) => segment === '..')) {
    throw new GoalAttachmentStoreError(
      'Invalid Goal asset path: parent traversal is not allowed',
    )
  }

  const normalized = pathPosix.normalize(slashNormalized)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new GoalAttachmentStoreError('Invalid Goal asset path: path must stay within Goal docs')
  }

  return normalized
}

function validateAssistantImages(files: File[]) {
  if (files.length > MAX_ASSISTANT_IMAGE_ATTACHMENTS) {
    throw new GoalAttachmentStoreError(
      `Too many assistant images: at most ${MAX_ASSISTANT_IMAGE_ATTACHMENTS} are allowed.`,
    )
  }
}

function validateAssistantImageFile(file: File) {
  if (!GOAL_ATTACHMENT_MEDIA_TYPES.includes(file.type as GoalAttachmentMediaType)) {
    throw new GoalAttachmentStoreError(
      `Unsupported assistant image type: ${file.type || 'unknown'}.`,
    )
  }
  if (file.size > MAX_ASSISTANT_IMAGE_SIZE_BYTES) {
    throw new GoalAttachmentStoreError(
      `Assistant image is too large: ${file.name || 'image'} exceeds ${MAX_ASSISTANT_IMAGE_SIZE_BYTES} bytes.`,
    )
  }
}

function sanitizeGoalAttachmentFileName(fileName: string, mediaType: string) {
  const baseName = basename(fileName || 'image').trim()
  const rawStem = baseName.slice(0, Math.max(0, baseName.length - extname(baseName).length))
  const normalizedStem = (rawStem || 'image')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  const extension = extname(baseName) || defaultExtensionForMediaType(mediaType)
  return `${normalizedStem || 'image'}${extension.toLowerCase()}`
}

function defaultExtensionForMediaType(mediaType: string) {
  switch (mediaType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return ''
  }
}
