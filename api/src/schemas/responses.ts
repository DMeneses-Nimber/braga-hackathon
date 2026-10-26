import { z } from '@hono/zod-openapi'

import { CompanySchema } from './company.js'
import { EvidenceSchema, SearchSchema } from './evidence.js'
import { ProposalSchema } from './proposal.js'
import { RecordedDecisionSchema, StepSchema } from './verification.js'

/** A company in the alphabetical list, with how many proposals are waiting. */
export const CompanyListItemSchema = CompanySchema.extend({
  pendingProposals: z.number().int().nonnegative(),
}).openapi('EmpresaNaLista')

/** A company, the evidence and searches of its latest verification, and its proposals. */
export const CompanyDetailSchema = z
  .object({
    company: CompanySchema,
    evidence: z.array(EvidenceSchema).openapi({ description: 'Evidência da última verificação' }),
    searches: z
      .array(SearchSchema)
      .openapi({ description: 'Fontes pesquisadas na última verificação, por campo, com ou sem resultado' }),
    proposals: z.array(ProposalSchema).openapi({ description: 'Propostas da empresa, mais recentes primeiro' }),
  })
  .openapi('DetalheEmpresa')

/** What one verification returns. The steps are not stored. */
export const VerificationResultSchema = z
  .object({
    decisions: z.array(RecordedDecisionSchema).openapi({ description: 'Uma decisão por campo' }),
    steps: z.array(StepSchema).openapi({ description: 'Passos dos agentes e da API, por ordem' }),
    evidence: z.array(EvidenceSchema),
    searches: z.array(SearchSchema),
    proposals: z.array(ProposalSchema).openapi({ description: 'Propostas criadas por esta verificação' }),
  })
  .openapi('ResultadoVerificacao')

/** An approved proposal and the company after the change. */
export const ApproveResultSchema = z
  .object({
    proposal: ProposalSchema,
    company: CompanySchema,
  })
  .openapi('ResultadoAprovacao')

/** A rejected proposal. The company is unchanged. */
export const RejectResultSchema = z
  .object({
    proposal: ProposalSchema,
  })
  .openapi('ResultadoRejeicao')

/** Whether the agents are connected, and with which models and tools. */
export const AgentsStatusSchema = z
  .object({
    enabled: z.boolean().openapi({ description: 'Se os agentes estão ligados' }),
    reason: z.string().nullable().openapi({ description: 'Porque estão desligados, ou um aviso' }),
    models: z.object({
      browse: z.string(),
      compare: z.string(),
    }),
    tools: z.object({
      googleMaps: z.boolean().openapi({ description: 'Há chave do Google Maps' }),
      webSearch: z.boolean().openapi({ description: 'Há chave da Tavily' }),
    }),
    offline: z.boolean().openapi({ description: 'Só respostas guardadas, sem internet' }),
  })
  .openapi('EstadoAgentes')

/** A company row in the list. */
export type CompanyListItem = z.infer<typeof CompanyListItemSchema>

/** The company detail screen. */
export type CompanyDetail = z.infer<typeof CompanyDetailSchema>

/** The result of one verification. */
export type VerificationResult = z.infer<typeof VerificationResultSchema>

/** The result of approving a proposal. */
export type ApproveResult = z.infer<typeof ApproveResultSchema>

/** The result of rejecting a proposal. */
export type RejectResult = z.infer<typeof RejectResultSchema>

/** What GET /agentes reports. */
export type AgentsStatus = z.infer<typeof AgentsStatusSchema>

/** One line of the NDJSON verification stream. */
export type VerificationEvent =
  | { type: 'step'; step: z.infer<typeof StepSchema> }
  | { type: 'result'; result: VerificationResult }
  | {
      type: 'error'
      error: { status: number; code: string; message: string; details?: unknown }
    }
