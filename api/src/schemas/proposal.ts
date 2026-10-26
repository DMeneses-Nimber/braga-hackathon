import { z } from '@hono/zod-openapi'

import { FieldSchema, NifSchema, TimestampSchema } from './common.js'

/** The three review states of a proposal. */
export const PROPOSAL_STATUSES = ['pendente', 'aprovada', 'rejeitada'] as const

/** A proposal's review state. */
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES).openapi({ example: 'pendente' })

/** A proposal id: "p-" and one or more digits. */
export const ProposalIdSchema = z
  .string()
  .regex(/^p-\d+$/, 'O id de uma proposta tem a forma p-001.')
  .openapi({ example: 'p-001' })

/** A proposal in summary.json, the original example's keys plus the field. */
export const ProposalSchema = z
  .object({
    id: ProposalIdSchema,
    entity: z.string().openapi({ example: 'CTT', description: 'Nome curto da empresa' }),
    entityId: NifSchema,
    field: FieldSchema,
    currentValue: z.string().nullable().openapi({ example: 'Rua de São José, 20, 1150-321 Lisboa' }),
    newValue: z.string().nullable().openapi({ example: 'Avenida D. João II, 13, 1999-001 Lisboa' }),
    source: z.string().nullable().openapi({ example: 'site' }),
    extractProof: z.string().nullable().openapi({ example: 'AVENIDA D. JOÃO II, 13 1999-001 LISBOA' }),
    verifiedAt: TimestampSchema,
    reason: z.string().openapi({ example: 'Morada oficial diferente; empresa confirmada pelo nome.' }),
    status: ProposalStatusSchema,
    rejectionReason: z.string().openapi({ description: 'Vazio até a proposta ser rejeitada' }),
    user: z.string().openapi({ description: 'Quem aprovou ou rejeitou; vazio até lá' }),
  })
  .openapi('Proposta')

/** A proposals list filter: one status, or every status. */
export const ProposalFilterSchema = z.enum(['pendente', 'aprovada', 'rejeitada', 'todas'])

const ReviewerNameSchema = z.string().trim().min(1).max(100).openapi({ example: 'Fábio' })

/** The optional body of an approval. */
export const ApproveBodySchema = z
  .object({
    user: ReviewerNameSchema.optional(),
  })
  .openapi('PedidoAprovacao')

/** The body of a rejection: a reason, and an optional reviewer. */
export const RejectBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Indique o motivo da rejeição.')
      .max(500)
      .openapi({ example: 'A morada encontrada é de uma filial.' }),
    user: ReviewerNameSchema.optional(),
  })
  .openapi('PedidoRejeicao')

/** A proposal. */
export type Proposal = z.infer<typeof ProposalSchema>

/** pendente, aprovada or rejeitada. */
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>

/** A status filter, including "todas". */
export type ProposalFilter = z.infer<typeof ProposalFilterSchema>
