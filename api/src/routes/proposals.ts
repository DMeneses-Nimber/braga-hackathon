import { createRoute, z } from '@hono/zod-openapi'

import type { Database } from '../db/database.js'
import { listProposals } from '../db/proposals.js'
import type { ReviewService } from '../services/review.js'
import {
  ApproveBodySchema,
  ApproveResultSchema,
  NifSchema,
  ProposalFilterSchema,
  ProposalIdSchema,
  ProposalSchema,
  RejectBodySchema,
  RejectResultSchema,
} from '../schemas/index.js'
import { createRouter, errorResponse, jsonContent } from './router.js'

const tag = 'Propostas'
const IdParams = z.object({ id: ProposalIdSchema })

const listRoute = createRoute({
  method: 'get',
  path: '/propostas',
  tags: [tag],
  summary: 'Lista as propostas, por omissão as que esperam revisão',
  request: {
    query: z.object({
      status: ProposalFilterSchema.default('pendente').openapi({
        description: 'pendente (por omissão), aprovada, rejeitada ou todas',
      }),
      nif: NifSchema.optional(),
    }),
  },
  responses: {
    200: jsonContent(z.array(ProposalSchema), 'Propostas, mais recentes primeiro'),
    400: errorResponse('Filtro inválido'),
  },
})

const approveRoute = createRoute({
  method: 'post',
  path: '/propostas/{id}/aprovar',
  tags: [tag],
  summary: 'Aprova uma proposta e altera o campo da empresa',
  request: {
    params: IdParams,
    body: {
      content: { 'application/json': { schema: ApproveBodySchema } },
      required: false,
    },
  },
  responses: {
    200: jsonContent(ApproveResultSchema, 'Proposta aprovada e empresa atualizada'),
    400: errorResponse('Pedido inválido'),
    404: errorResponse('Proposta ou empresa não encontrada'),
    409: errorResponse('A proposta já foi revista ou o valor da empresa mudou entretanto'),
    422: errorResponse('A proposta não tem valor novo ou o valor não é válido para o campo'),
  },
})

const rejectRoute = createRoute({
  method: 'post',
  path: '/propostas/{id}/rejeitar',
  tags: [tag],
  summary: 'Rejeita uma proposta sem alterar a empresa',
  request: {
    params: IdParams,
    body: {
      content: { 'application/json': { schema: RejectBodySchema } },
      required: true,
    },
  },
  responses: {
    200: jsonContent(RejectResultSchema, 'Proposta rejeitada'),
    400: errorResponse('Falta o motivo ou o pedido é inválido'),
    404: errorResponse('Proposta não encontrada'),
    409: errorResponse('A proposta já foi revista'),
  },
})

/** The proposal list, and approving or rejecting one. */
export function proposalRoutes(db: Database, review: ReviewService) {
  const app = createRouter()

  app.openapi(listRoute, async (c) => {
    const query = c.req.valid('query')
    const status = query.status === 'todas' ? undefined : query.status
    return c.json(await listProposals(db, { status, nif: query.nif }), 200)
  })

  app.openapi(approveRoute, async (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    return c.json(await review.approve(id, { user: body?.user }), 200)
  })

  app.openapi(rejectRoute, async (c) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    return c.json(await review.reject(id, body), 200)
  })

  return app
}
