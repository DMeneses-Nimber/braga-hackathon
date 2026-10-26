import { createRoute } from '@hono/zod-openapi'

import { ApiError } from '../errors.js'
import { ErrorResponseSchema } from '../schemas/index.js'
import { createRouter, jsonContent } from './router.js'

const route = createRoute({
  method: 'get',
  path: '/avaliacao',
  tags: ['Avaliação'],
  summary: 'Números dos agentes e das duas referências',
  description: 'Ainda não implementada: devolve 501 até existirem os agentes e as referências.',
  responses: {
    501: jsonContent(ErrorResponseSchema, 'A avaliação ainda não está implementada'),
  },
})

/** The evaluation endpoint. It answers 501 until the agents and the references exist. */
export function evaluationRoutes() {
  const app = createRouter()
  app.openapi(route, () => {
    throw new ApiError(
      501,
      'AVALIACAO_INDISPONIVEL',
      'A avaliação chega com os agentes e as referências; ainda não está implementada.',
    )
  })
  return app
}
