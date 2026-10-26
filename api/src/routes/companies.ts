import { createRoute, z } from '@hono/zod-openapi'
import { stream } from 'hono/streaming'

import type { VerificationService } from '../services/verification.js'
import { getCompanyDetail, listCompaniesWithProposals } from '../services/companies.js'
import type { Database } from '../db/database.js'
import { ApiError } from '../errors.js'
import {
  CompanyDetailSchema,
  CompanyListItemSchema,
  NifSchema,
  VerificationResultSchema,
  type VerificationEvent,
} from '../schemas/index.js'
import { createRouter, errorResponse, jsonContent } from './router.js'

const tag = 'Empresas'
const NifParams = z.object({ nif: NifSchema })

const listRoute = createRoute({
  method: 'get',
  path: '/empresas',
  tags: [tag],
  summary: 'Lista as empresas com o número de propostas pendentes',
  responses: {
    200: jsonContent(z.array(CompanyListItemSchema), 'Empresas por ordem alfabética'),
    500: errorResponse('Ficheiro de dados inválido'),
  },
})

const detailRoute = createRoute({
  method: 'get',
  path: '/empresas/{nif}',
  tags: [tag],
  summary: 'Detalhe de uma empresa: a evidência da última verificação e as propostas',
  request: { params: NifParams },
  responses: {
    200: jsonContent(CompanyDetailSchema, 'Detalhe da empresa'),
    400: errorResponse('NIF inválido'),
    404: errorResponse('Empresa não encontrada'),
  },
})

const verifyRoute = createRoute({
  method: 'post',
  path: '/empresas/{nif}/verificar',
  tags: [tag],
  summary: 'Corre o agente de recolha e o de comparação e cria as propostas pendentes',
  description:
    'Devolve as decisões por campo e os passos dos agentes, que não ficam guardados. Devolve 501 enquanto os agentes não estiverem ligados à API.',
  request: { params: NifParams },
  responses: {
    201: jsonContent(VerificationResultSchema, 'Verificação concluída'),
    400: errorResponse('NIF inválido'),
    404: errorResponse('Empresa não encontrada'),
    409: errorResponse('Já está a decorrer uma verificação desta empresa'),
    500: errorResponse('Um agente falhou ou devolveu dados inválidos'),
    501: errorResponse('Os agentes ainda não estão ligados'),
  },
})

/** The company list, the detail, the verification and its live stream. */
export function companyRoutes(db: Database, verification: VerificationService) {
  const app = createRouter()

  app.openapi(listRoute, async (c) => {
    return c.json(await listCompaniesWithProposals(db), 200)
  })

  app.openapi(detailRoute, async (c) => {
    const { nif } = c.req.valid('param')
    return c.json(await getCompanyDetail(db, nif), 200)
  })

  app.openapi(verifyRoute, async (c) => {
    const { nif } = c.req.valid('param')
    return c.json(await verification.verify(nif), 201)
  })

  // The same verification as NDJSON: one line per step as it happens, then the result or the error.
  app.post('/empresas/:nif/verificar/stream', async (c) => {
    const parsed = NifSchema.safeParse(c.req.param('nif'))
    if (!parsed.success) throw new ApiError(400, 'PEDIDO_INVALIDO', 'O NIF tem de ter 9 dígitos.')
    const nif = parsed.data
    // An unknown company, agents that are off, or a run already in progress come back as JSON, before any streaming.
    await verification.check(nif)
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
    c.header('Cache-Control', 'no-cache')
    return stream(c, async (output) => {
      let chain = Promise.resolve()
      const send = (event: VerificationEvent): Promise<void> => {
        chain = chain.then(() => output.write(`${JSON.stringify(event)}\n`)).then(() => undefined)
        return chain
      }
      try {
        const result = await verification.verify(nif, {
          onStep: (step) => {
            void send({ type: 'step', step })
          },
        })
        await send({ type: 'result', result })
      } catch (error) {
        const api =
          error instanceof ApiError
            ? error
            : new ApiError(500, 'ERRO_INTERNO', 'Ocorreu um erro inesperado na API.')
        await send({
          type: 'error',
          error: {
            status: api.status,
            code: api.code,
            message: api.message,
            ...(api.details !== undefined ? { details: api.details } : {}),
          },
        })
      }
      await chain
    })
  })

  return app
}
