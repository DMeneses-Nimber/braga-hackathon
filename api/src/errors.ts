import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Error the API returns as JSON, with a Portuguese code and message. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly details: unknown

  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** The JSON body of every error response. Leaves details out when there are none. */
export function errorBody(
  code: string,
  message: string,
  details?: unknown,
): { error: { code: string; message: string; details?: unknown } } {
  const error: { code: string; message: string; details?: unknown } = { code, message }
  if (details !== undefined) error.details = details
  return { error }
}

/** Turns validation issues into path and message pairs. */
export function describeIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): { path: string; message: string }[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
}

/** 404 for a NIF that is not in the working copy. */
export function companyNotFound(nif: string): ApiError {
  return new ApiError(404, 'EMPRESA_NAO_ENCONTRADA', `Não existe nenhuma empresa com o NIF ${nif}.`)
}

/** 404 for a proposal id that is not in the summary. */
export function proposalNotFound(id: string): ApiError {
  return new ApiError(404, 'PROPOSTA_NAO_ENCONTRADA', `Não existe nenhuma proposta com o id ${id}.`)
}
