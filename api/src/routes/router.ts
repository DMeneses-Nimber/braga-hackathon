import { OpenAPIHono, z } from '@hono/zod-openapi'

import { describeIssues, errorBody } from '../errors.js'
import { ErrorResponseSchema } from '../schemas/index.js'

/** A new OpenAPI router. An invalid param, query or body is 400 PEDIDO_INVALIDO. */
export function createRouter(): OpenAPIHono {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody('PEDIDO_INVALIDO', 'O pedido não é válido.', describeIssues(result.error.issues)),
          400,
        )
      }
    },
  })
}

/** The OpenAPI description of a JSON response. */
export function jsonContent(schema: z.ZodType, description: string) {
  return {
    description,
    content: {
      'application/json': { schema },
    },
  }
}

/** The OpenAPI description of an error response. */
export function errorResponse(description: string) {
  return jsonContent(ErrorResponseSchema, description)
}
