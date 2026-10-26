import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { serveStatic } from '@hono/node-server/serve-static'
import { swaggerUI } from '@hono/swagger-ui'

import type { Agents } from './agents/types.js'
import { Database } from './db/database.js'
import { ApiError, errorBody } from './errors.js'
import { agentRoutes } from './routes/agents.js'
import { companyRoutes } from './routes/companies.js'
import { evaluationRoutes } from './routes/evaluation.js'
import { proposalRoutes } from './routes/proposals.js'
import { createRouter } from './routes/router.js'
import { weeklyRoutes } from './routes/weekly.js'
import type { AgentsStatus } from './schemas/index.js'
import { ReviewService } from './services/review.js'
import { VerificationService } from './services/verification.js'
import { WeeklyVerificationService, type WeeklyOptions } from './services/weekly.js'

const UNAVAILABLE = 'Os agentes de recolha e de comparação não estão ligados a esta API.'

/** What createApp needs. The clock, the agents and the weekly timings can be replaced in tests. */
export interface AppOptions {
  dataDir: string
  agents?: Agents
  agentsStatus?: AgentsStatus
  now?: () => Date
  weekly?: Pick<WeeklyOptions, 'intervalMs' | 'pauseMs'>
  logRequests?: boolean
  staticDir?: string
}

/** The services the HTTP routes close over. */
export interface ApiServices {
  db: Database
  verification: VerificationService
  review: ReviewService
  weekly: WeeklyVerificationService
  agentsStatus: AgentsStatus
}

/** Mounts the five route groups. The type of the result is kept for a typed client. */
export function buildApi(services: ApiServices) {
  const api = createRouter()
  api.route('/', companyRoutes(services.db, services.verification))
  api.route('/', proposalRoutes(services.db, services.review))
  api.route('/', weeklyRoutes(services.weekly))
  api.route('/', agentRoutes(services.agentsStatus))
  api.route('/', evaluationRoutes())
  return api
}

/** The type of the API router, kept for a typed client. */
export type ApiType = ReturnType<typeof buildApi>

/** Builds the API, prepares the data files and starts the weekly verification. */
export async function createApp(options: AppOptions): Promise<{
  app: Hono
  db: Database
  weekly: WeeklyVerificationService
}> {
  const now = options.now ?? (() => new Date())
  const db = new Database(options.dataDir)
  await db.ensureReady()
  const status: AgentsStatus = options.agentsStatus ?? {
    enabled: options.agents !== undefined,
    reason: options.agents ? null : UNAVAILABLE,
    models: { browse: '', compare: '' },
    tools: { googleMaps: false, webSearch: false },
    offline: false,
  }
  const verification = new VerificationService(db, options.agents, now, {
    unavailableReason: status.reason,
  })
  const weekly = new WeeklyVerificationService(db, verification, {
    now,
    unavailableReason: options.agents ? null : status.reason,
    log: options.logRequests ? (message) => console.log(message) : undefined,
    ...options.weekly,
  })
  await weekly.start()
  const api = buildApi({
    db,
    verification,
    review: new ReviewService(db),
    weekly,
    agentsStatus: status,
  })
  api.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Data Integrity Agent API',
      version: '0.1.0',
      description:
        'Empresas e evidência em data/runtime/, propostas em data/summary/summary.json. Os agentes ligam-se com a chave do Grok em api/.env; GET /agentes diz se estão ligados. POST /empresas/{nif}/verificar/stream devolve a mesma verificação em NDJSON, passo a passo. PUT /verificacao-semanal liga a verificação de todas as empresas uma vez por semana. GET /avaliacao devolve 501.',
    },
    servers: [{ url: '/api' }],
    tags: [
      { name: 'Empresas' },
      { name: 'Propostas' },
      { name: 'Verificação semanal' },
      { name: 'Agentes' },
      { name: 'Avaliação' },
    ],
  })
  api.get('/docs', swaggerUI({ url: '/api/openapi.json' }))

  const app = new Hono()
  if (options.logRequests) app.use(logger())
  app.route('/api', api)
  if (options.staticDir) mountStatic(app, options.staticDir)
  app.notFound((c) => c.json(errorBody('ROTA_NAO_ENCONTRADA', `Não existe ${c.req.method} ${c.req.path}.`), 404))
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json(errorBody(error.code, error.message, error.details), error.status)
    if (error instanceof HTTPException) {
      const code =
        error.status === 415 ? 'TIPO_DE_CONTEUDO_INVALIDO' : error.status < 500 ? 'PEDIDO_INVALIDO' : 'ERRO_INTERNO'
      const status = error.status as ContentfulStatusCode
      return c.json(errorBody(code, error.message || 'O pedido não é válido.'), status)
    }
    console.error(error)
    return c.json(errorBody('ERRO_INTERNO', 'Ocorreu um erro inesperado na API.'), 500)
  })
  return { app, db, weekly }
}

function mountStatic(app: Hono, staticDir: string): void {
  app.use('*', async (c, next) => {
    if (isApiPath(c.req.path)) return next()
    return serveStatic({ root: staticDir })(c, next)
  })
  app.get('*', async (c, next) => {
    if (isApiPath(c.req.path)) return next()
    return serveStatic({ root: staticDir, path: 'index.html' })(c, next)
  })
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/')
}
