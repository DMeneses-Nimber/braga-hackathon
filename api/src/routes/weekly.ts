import { createRoute } from '@hono/zod-openapi'

import type { WeeklyVerificationService } from '../services/weekly.js'
import { WeeklyStatusSchema, WeeklyUpdateSchema } from '../schemas/index.js'
import { createRouter, errorResponse, jsonContent } from './router.js'

const tag = 'Verificação semanal'

const statusRoute = createRoute({
  method: 'get',
  path: '/verificacao-semanal',
  tags: [tag],
  summary: 'Se a verificação semanal está ligada, a ronda em curso e a última',
  responses: {
    200: jsonContent(WeeklyStatusSchema, 'Estado da verificação semanal'),
  },
})

const updateRoute = createRoute({
  method: 'put',
  path: '/verificacao-semanal',
  tags: [tag],
  summary: 'Liga ou desliga a verificação semanal',
  description:
    'Ao ligar, a primeira ronda começa logo e repete-se todas as semanas: cada empresa é verificada, uma de cada vez, como no botão Verificar empresa, e consome tokens. Ao desligar, a ronda em curso para depois da empresa atual.',
  request: {
    body: {
      content: { 'application/json': { schema: WeeklyUpdateSchema } },
      required: true,
    },
  },
  responses: {
    200: jsonContent(WeeklyStatusSchema, 'O novo estado'),
    400: errorResponse('Pedido inválido'),
    501: errorResponse('Os agentes estão desligados'),
  },
})

/** The weekly verification's status and its switch. */
export function weeklyRoutes(weekly: WeeklyVerificationService) {
  const app = createRouter()

  app.openapi(statusRoute, async (c) => c.json(await weekly.status(), 200))

  app.openapi(updateRoute, async (c) => {
    const { enabled } = c.req.valid('json')
    return c.json(await weekly.setEnabled(enabled), 200)
  })

  return app
}
