// The types come from the API's Zod schemas, the agreement between the app, the API and the agents.
export type {
  AgentsStatus,
  ApproveResult,
  Company,
  CompanyDetail,
  CompanyListItem,
  Decision,
  Evidence,
  Field,
  Proposal,
  ProposalFilter,
  ProposalStatus,
  RecordedDecision,
  RejectResult,
  Search,
  SearchOutcome,
  Source,
  Step,
  StepAgent,
  VerificationEvent,
  VerificationResult,
  WeeklyRound,
  WeeklyStatus,
} from '../../api/src/schemas/index.js'

import type {
  AgentsStatus,
  ApproveResult,
  CompanyDetail,
  CompanyListItem,
  Proposal,
  ProposalFilter,
  RejectResult,
  Step,
  VerificationEvent,
  VerificationResult,
  WeeklyStatus,
} from '../../api/src/schemas/index.js'

const UNREACHABLE = 'Não foi possível contactar a API. Confirme que está a correr (npm run dev na pasta api).'

/** An error answered by the API, or a failure to reach it. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Keeps an ApiError, and wraps anything else. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ApiError(0, 'ERRO', message)
}

// The API always answers errors in JSON, so anything else comes from the dev proxy failing to reach it.
function errorFrom(status: number, body: unknown): ApiError {
  const error =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error?: { code?: string; message?: string; details?: unknown } }).error
      : undefined
  if (!error) return new ApiError(status, 'SEM_LIGACAO', UNREACHABLE)
  return new ApiError(status, error.code || 'ERRO', error.message || `A API respondeu ${status}.`, error.details)
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...options, headers })
  } catch {
    throw new ApiError(0, 'SEM_LIGACAO', UNREACHABLE)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (!response.ok) throw errorFrom(response.status, body)
  return body as T
}

function post<T>(path: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
}

/** The verification over NDJSON. Each step goes to onStep as the agents work. */
export async function verifyCompanyStream(
  nif: string,
  onStep: (step: Step) => void,
): Promise<VerificationResult> {
  let response: Response
  try {
    response = await fetch(`/api/empresas/${nif}/verificar/stream`, {
      method: 'POST',
      headers: { Accept: 'application/x-ndjson' },
    })
  } catch {
    throw new ApiError(0, 'SEM_LIGACAO', UNREACHABLE)
  }
  if (!response.ok || !response.body) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    throw errorFrom(response.status, body)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      const event = JSON.parse(line) as VerificationEvent
      if (event.type === 'step') onStep(event.step)
      else if (event.type === 'result') return event.result
      else throw new ApiError(event.error.status, event.error.code, event.error.message, event.error.details)
    }
  }
  throw new ApiError(0, 'SEM_LIGACAO', 'A ligação à API caiu antes do fim da verificação.')
}

export const api = {
  listCompanies: () => request<CompanyListItem[]>('/empresas'),
  getCompany: (nif: string) => request<CompanyDetail>(`/empresas/${nif}`),
  verifyCompany: (nif: string) => post<VerificationResult>(`/empresas/${nif}/verificar`),
  verifyCompanyStream,
  getAgents: () => request<AgentsStatus>('/agentes'),
  getWeekly: () => request<WeeklyStatus>('/verificacao-semanal'),
  setWeekly: (enabled: boolean) =>
    request<WeeklyStatus>('/verificacao-semanal', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  listProposals: (status: ProposalFilter = 'pendente', nif?: string) => {
    const params = new URLSearchParams({ status })
    if (nif) params.set('nif', nif)
    return request<Proposal[]>(`/propostas?${params}`)
  },
  approveProposal: (id: string, user: string) =>
    post<ApproveResult>(`/propostas/${id}/aprovar`, user ? { user } : {}),
  rejectProposal: (id: string, reason: string, user: string) =>
    post<RejectResult>(`/propostas/${id}/rejeitar`, user ? { reason, user } : { reason }),
}
