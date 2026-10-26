import { z } from '@hono/zod-openapi'

/** The fields the agents verify, named like the company keys. */
export const FIELDS = ['address', 'cae', 'site', 'status'] as const

/** Sources a piece of evidence or a search can come from. */
export const SOURCES = [
  'site',
  'googleMaps',
  'teamlyzer',
  'linkedin',
  'instagram',
  'facebook',
  'x',
  'wikipedia',
  'sicae',
  'contribuinte',
  'web',
] as const

/** Only `propor` and `rever` create a proposal. */
export const DECISIONS = ['manter', 'propor', 'ignorar', 'rever'] as const

/** Legal statuses a company record accepts. */
export const COMPANY_STATUSES = [
  'Ativa',
  'Inativa',
  'Em liquidação',
  'Insolvente',
  'Suspensa',
  'Cessada',
  'Dissolvida',
] as const

/** A Portuguese company tax number: exactly 9 digits. */
export const NifSchema = z
  .string()
  .regex(/^\d{9}$/, 'O NIF tem de ter 9 dígitos.')
  .openapi({ example: '500077568' })

/** One of the four company fields the agents verify. */
export const FieldSchema = z.enum(FIELDS).openapi({ example: 'address' })

/** One of the sources the agents read. */
export const SourceSchema = z.enum(SOURCES).openapi({ example: 'site' })

/** What the comparison agent decided for a field. */
export const DecisionSchema = z.enum(DECISIONS).openapi({ example: 'propor' })

// The repository's summary.json contains "2026-10-26T15:02:00".
/** An ISO 8601 date-time, with a zone offset or without one. */
export const TimestampSchema = z
  .iso
  .datetime({ local: true, offset: true })
  .openapi({ example: '2026-10-26T15:02:00.000Z' })

/** The error JSON every failed request returns. */
export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'EMPRESA_NAO_ENCONTRADA' }),
      message: z.string().openapi({ example: 'Não existe nenhuma empresa com o NIF 500000000.' }),
      details: z.any().optional(),
    }),
  })
  .openapi('Erro')

/** A company field key. */
export type Field = z.infer<typeof FieldSchema>

/** A source key. */
export type Source = z.infer<typeof SourceSchema>

/** A comparison decision. */
export type Decision = z.infer<typeof DecisionSchema>

/** Field names as they appear inside a sentence. */
export const FIELD_LABELS: Record<Field, string> = {
  address: 'morada',
  cae: 'CAE',
  site: 'website',
  status: 'estado',
}
