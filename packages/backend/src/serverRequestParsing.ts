import type { z } from 'zod'
import { assistantRunSchema } from './serverSchemas'
import { HttpError, parseAssistantImageEntries } from './serverSupport'
import type { goalAttachmentRefArraySchema } from './storage/goalAttachmentStore'

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'Invalid request body')
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request body')
  }
  return parsed.data
}

export async function parseAssistantAttachmentUploadBody(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new HttpError(400, 'Invalid request body')
  }
  return {
    images: parseAssistantImageEntries(formData),
  }
}

export async function parseAssistantRunBody(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    const body = await parseJsonBody(request, assistantRunSchema)
    return {
      content: body.content,
      attachments: body.attachments,
      appendUserMessage: body.appendUserMessage,
      images: [] as File[],
    }
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new HttpError(400, 'Invalid request body')
  }

  const content = formData.get('content')
  if (typeof content !== 'string') {
    throw new HttpError(400, 'Invalid request body')
  }

  const appendUserMessageValue = formData.get('appendUserMessage')
  const parsed = assistantRunSchema.safeParse({
    content,
    appendUserMessage:
      appendUserMessageValue === null
        ? true
        : appendUserMessageValue === 'true'
          ? true
          : appendUserMessageValue === 'false'
            ? false
            : appendUserMessageValue,
  })
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request body')
  }

  return {
    content: parsed.data.content,
    attachments: [] as z.infer<typeof goalAttachmentRefArraySchema>,
    appendUserMessage: parsed.data.appendUserMessage,
    images: parseAssistantImageEntries(formData),
  }
}

export async function readBundleFile(path: string) {
  const file = Bun.file(path)
  return {
    path,
    content: (await file.exists()) ? await file.text() : null,
  }
}
