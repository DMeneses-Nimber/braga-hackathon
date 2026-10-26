/** How a fetch is made: method, body, headers, timeout, size cap and an abort signal. */
export interface FetchOptions {
  method?: 'GET' | 'POST'
  body?: string | Record<string, string>
  headers?: Record<string, string>
  timeoutMs?: number
  maxBytes?: number
  signal?: AbortSignal
}

/** A page body, after redirects, with the headers the caller needs. */
export interface TextResponse {
  finalUrl: string
  redirects: string[]
  status: number
  contentType: string
  text: string
  truncated: boolean
  cookies: string[]
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'DataIntegrityAgent/0.1 (verificação de dados de empresas)',
  'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.6',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
}

/** Only public http and https. Pages never come from this machine or the local network. */
export function assertPublicUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Só se abrem endereços http ou https: ${value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Só se abrem endereços http ou https: ${value}`)
  }
  if (isLocal(url.hostname)) throw new Error(`Endereço local não permitido: ${url.hostname}`)
  return url
}

function isLocal(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host.startsWith('[')) return true
  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local') || host.endsWith('.internal')) return true
  const parts = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (!parts) return false
  const first = Number(parts[1])
  const second = Number(parts[2])
  if (first === 127 || first === 10) return true
  if (first === 192 && second === 168) return true
  if (first === 169 && second === 254) return true
  return first === 172 && second >= 16 && second <= 31
}

/** A fetch failure as an error text, and whether it was a timeout or a network error. */
export function describeFailure(error: unknown): { error: string; transient: boolean } {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { error: 'A fonte demorou demasiado a responder.', transient: true }
  }
  if (error instanceof TypeError) {
    return { error: `Não foi possível contactar a fonte (${error.message}).`, transient: true }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { error: message, transient: false }
}

/** Fetches a page with a timeout and a size cap, checking every redirect against the local network. */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<TextResponse> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxBytes = options.maxBytes ?? 2_000_000
  let current = assertPublicUrl(url)
  let method = options.method ?? 'GET'
  let body = encodeBody(options.body)
  const redirects: string[] = []
  const headers = { ...DEFAULT_HEADERS, ...options.headers }

  for (;;) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const response = await fetch(current, { method, body, headers, redirect: 'manual', signal })
    if (isRedirect(response.status)) {
      await response.body?.cancel()
      if (redirects.length >= 5) throw new Error('Demasiados redirecionamentos.')
      const location = response.headers.get('location')
      if (!location) throw new Error('Demasiados redirecionamentos.')
      const next = assertPublicUrl(new URL(location, current).href)
      redirects.push(next.href)
      if (response.status === 303 || method === 'POST') {
        method = 'GET'
        body = undefined
      }
      current = next
      continue
    }
    const contentType = response.headers.get('content-type') ?? ''
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
    const read = await readBody(response, maxBytes, contentType)
    return { finalUrl: current.href, redirects, status: response.status, contentType, cookies, ...read }
  }
}

function encodeBody(body: FetchOptions['body']): string | undefined {
  if (body === undefined) return undefined
  if (typeof body === 'string') return body
  return new URLSearchParams(body).toString()
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function readBody(
  response: Response,
  maxBytes: number,
  contentType: string,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader) return { text: '', truncated: false }
  const chunks: Uint8Array[] = []
  let received = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    if (received + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - received))
      truncated = true
      await reader.cancel()
      break
    }
    chunks.push(value)
    received += value.length
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return { text: new TextDecoder(charsetOf(contentType)).decode(bytes), truncated }
}

function charsetOf(contentType: string): string {
  const match = /charset=([^;]+)/i.exec(contentType)
  const charset = match?.[1]?.trim().toLowerCase().replaceAll('"', '')
  if (charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252') return 'windows-1252'
  return 'utf-8'
}
