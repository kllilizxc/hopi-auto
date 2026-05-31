import { z } from 'zod'
import { roleTransportConfigSchema } from './vendorTransport'

export const agentAdapterConfigSchema = z.object({
  version: z.literal(1),
  assistant: roleTransportConfigSchema.optional(),
  roles: z
    .object({
      planner: roleTransportConfigSchema.optional(),
      generator: roleTransportConfigSchema.optional(),
      reviewer: roleTransportConfigSchema.optional(),
      merger: roleTransportConfigSchema.optional(),
    })
    .default({}),
})

export type AgentAdapterConfig = z.infer<typeof agentAdapterConfigSchema>
