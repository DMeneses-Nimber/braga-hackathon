import { z } from '@hono/zod-openapi'

import { NifSchema } from './common.js'

const timestamp = () =>
  z.iso.datetime({ local: true, offset: true }).openapi({ example: '2026-10-26T15:02:00.000Z' })

const count = () => z.number().int().nonnegative()

const roundFields = {
  startedAt: timestamp(),
  finishedAt: timestamp().nullable().openapi({ description: 'Vazio enquanto a ronda decorre' }),
  total: count().openapi({ description: 'Empresas na ronda' }),
  done: count().openapi({ description: 'Empresas já tratadas' }),
  verified: count(),
  skipped: count().openapi({
    description: 'Empresas saltadas: já estavam a ser verificadas à mão, ou deixaram de existir',
  }),
  failures: z.array(
    z.object({
      nif: NifSchema,
      casualName: z.string(),
      error: z.string(),
    }),
  ),
  proposals: count().openapi({ description: 'Propostas novas criadas na ronda' }),
  interrupted: z.boolean().openapi({ description: 'A verificação semanal foi desligada antes do fim da ronda' }),
}

/** One weekly round, finished or still running. */
export const WeeklyRoundSchema = z.object(roundFields).openapi('RondaSemanal')

/** The contents of schedule.json. A reset leaves this file alone. */
export const WeeklyStateSchema = z.object({
  enabled: z.boolean(),
  nextRunAt: timestamp().nullable(),
  current: z
    .object({
      ...roundFields,
      nifs: z.array(NifSchema),
    })
    .nullable(),
  last: WeeklyRoundSchema.nullable(),
})

/** What GET /verificacao-semanal reports. */
export const WeeklyStatusSchema = z
  .object({
    enabled: z.boolean().openapi({ description: 'Se a verificação semanal está ligada' }),
    available: z.boolean().openapi({ description: 'Se os agentes estão ligados; sem eles não há rondas' }),
    reason: z
      .string()
      .nullable()
      .openapi({ description: 'Porque não há rondas, quando os agentes estão desligados' }),
    running: z.boolean().openapi({ description: 'Se está a decorrer uma ronda' }),
    stopping: z
      .boolean()
      .openapi({ description: 'Foi desligada a meio de uma ronda, que para depois da empresa atual' }),
    nextRunAt: timestamp().nullable().openapi({ description: 'Quando começa a próxima ronda' }),
    current: z
      .object({
        ...roundFields,
        company: z
          .object({
            nif: NifSchema,
            casualName: z.string(),
          })
          .nullable()
          .openapi({ description: 'A empresa que está a ser verificada agora' }),
      })
      .nullable(),
    last: WeeklyRoundSchema.nullable().openapi({ description: 'A última ronda terminada' }),
  })
  .openapi('EstadoVerificacaoSemanal')

/** The body that turns the weekly verification on or off. */
export const WeeklyUpdateSchema = z
  .object({
    enabled: z.boolean().openapi({ example: true }),
  })
  .openapi('AlterarVerificacaoSemanal')

/** A weekly round. */
export type WeeklyRound = z.infer<typeof WeeklyRoundSchema>

/** The schedule file. */
export type WeeklyState = z.infer<typeof WeeklyStateSchema>

/** The weekly verification status. */
export type WeeklyStatus = z.infer<typeof WeeklyStatusSchema>
