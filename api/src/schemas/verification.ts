import { z } from '@hono/zod-openapi'

import { DecisionSchema, FieldSchema, SourceSchema, TimestampSchema } from './common.js'
import { ProposalIdSchema } from './proposal.js'

/** Who produced a step: the collection agent, the comparison agent, or the API. */
export const STEP_AGENTS = ['recolha', 'comparacao', 'sistema'] as const

/** One line of a verification, shown in order on the company screen. */
export const StepSchema = z
  .object({
    at: TimestampSchema,
    agent: z.enum(STEP_AGENTS),
    message: z.string().min(1).openapi({ example: 'Morada encontrada na página de contactos.' }),
  })
  .openapi('Passo')

const decisionFields = {
  field: FieldSchema,
  decision: DecisionSchema,
  newValue: z.string().min(1).nullable(),
  source: SourceSchema.nullable(),
  url: z.url().nullable(),
  extractProof: z.string().min(1).nullable(),
  reason: z.string().min(1).openapi({ example: 'Morada oficial diferente; empresa confirmada pelo nome.' }),
}

/** A decision returned by the comparison agent. A `propor` needs a new value. */
export const FieldDecisionSchema = z
  .object(decisionFields)
  .superRefine((decision, ctx) => {
    if (decision.decision === 'propor' && decision.newValue === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['newValue'],
        message: 'Uma decisão propor precisa de newValue.',
      })
    }
  })
  .openapi('DecisaoCampo')

/** A decision stored in the verification result, with the current value and any proposal id. */
export const RecordedDecisionSchema = z
  .object({
    ...decisionFields,
    currentValue: z.string().nullable(),
    proposalId: ProposalIdSchema.nullable(),
  })
  .openapi('DecisaoRegistada')

/** One step of a verification. */
export type Step = z.infer<typeof StepSchema>

/** The agent, or the API, that recorded a step. */
export type StepAgent = (typeof STEP_AGENTS)[number]

/** A field decision from the comparison agent. */
export type FieldDecision = z.infer<typeof FieldDecisionSchema>

/** A field decision plus the value it was compared with and the proposal it created. */
export type RecordedDecision = z.infer<typeof RecordedDecisionSchema>
