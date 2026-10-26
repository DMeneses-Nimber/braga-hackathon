import { z } from '@hono/zod-openapi'

import { FieldSchema, NifSchema, SourceSchema, TimestampSchema } from './common.js'

/** How a search of one source for one field ended. */
export const SEARCH_OUTCOMES = ['encontrado', 'nada', 'falhou'] as const

const evidenceFields = {
  field: FieldSchema,
  value: z.string().min(1).openapi({ example: 'Avenida D. João II, 13, 1999-001 Lisboa' }),
  source: SourceSchema,
  url: z.url().openapi({ example: 'https://www.ctt.pt/contactos' }),
  extractProof: z
    .string()
    .min(1)
    .openapi({
      example: 'AVENIDA D. JOÃO II, 13 1999-001 LISBOA',
      description: 'Excerto literal da página',
    }),
}

const searchFields = {
  field: FieldSchema,
  source: SourceSchema,
  outcome: z.enum(SEARCH_OUTCOMES).openapi({
    example: 'encontrado',
    description: 'encontrado: a fonte tinha o campo; nada: foi pesquisada sem resultado; falhou: não respondeu',
  }),
  urls: z.array(z.url()).openapi({ description: 'As páginas consultadas nesta fonte' }),
  note: z
    .string()
    .min(1)
    .nullable()
    .openapi({ example: 'A Wikipedia não tem nenhum artigo para "Nimber".' }),
}

/** What the collection agent returns for one piece of evidence. */
export const CollectedEvidenceSchema = z
  .object({
    ...evidenceFields,
    foundAt: TimestampSchema.optional(),
  })
  .openapi('EvidenciaRecolhida')

/** Evidence stored for a company, with the NIF and the time it was found. */
export const EvidenceSchema = z
  .object({
    nif: NifSchema,
    ...evidenceFields,
    foundAt: TimestampSchema,
  })
  .openapi('Evidencia')

/** What the collection agent returns for one source it searched. */
export const CollectedSearchSchema = z.object(searchFields).openapi('PesquisaRecolhida')

/** A search stored for a company, with the NIF and the time it was made. */
export const SearchSchema = z
  .object({
    nif: NifSchema,
    ...searchFields,
    searchedAt: TimestampSchema,
  })
  .openapi('Pesquisa')

/** Evidence as the collection agent returns it. */
export type CollectedEvidence = z.infer<typeof CollectedEvidenceSchema>

/** Evidence stored on disk. */
export type Evidence = z.infer<typeof EvidenceSchema>

/** A search as the collection agent returns it. */
export type CollectedSearch = z.infer<typeof CollectedSearchSchema>

/** A search stored on disk. */
export type Search = z.infer<typeof SearchSchema>

/** The outcome of searching one source. */
export type SearchOutcome = (typeof SEARCH_OUTCOMES)[number]
