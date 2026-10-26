import { createRoute } from '@hono/zod-openapi'

import { AgentsStatusSchema, type AgentsStatus } from '../schemas/index.js'
import { createRouter, jsonContent } from './router.js'

const statusRoute = createRoute({
  method: 'get',
  path: '/agentes',
  tags: ['Agentes'],
  summary: 'Se os agentes estão ligados, com que modelos e com que ferramentas',
  responses: {
    200: jsonContent(AgentsStatusSchema, 'Estado dos agentes'),
  },
})

/** Reports the agents status captured when the API was created. */
export function agentRoutes(status: AgentsStatus) {
  const app = createRouter()
  app.openapi(statusRoute, (c) => c.json(status, 200))
  return app
}
