/** A source that didn't answer. Transient failures (timeouts, network errors) aren't cached. */
export interface Failure {
  ok: false
  error: string
  transient?: boolean
}

/** A CAE code and, when the source pairs it correctly, its description. */
export interface Cae {
  code: string
  description: string
}

/** Collapses whitespace and trims. */
export function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
