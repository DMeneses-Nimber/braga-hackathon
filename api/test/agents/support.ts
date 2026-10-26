import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { LanguageModelV4GenerateResult, LanguageModelV4ToolCall } from '@ai-sdk/provider'

import { loadSources } from '../../src/agents/skills.js'
import { SourceCatalog } from '../../src/agents/sources.js'
import type { AgentContext } from '../../src/agents/types.js'
import { API_ROOT } from '../../src/config.js'
import type { Evidence, Field, Source } from '../../src/schemas/index.js'

/** The repository's skills, next to the api folder. */
export const SKILLS_DIR = path.resolve(API_ROOT, '../.agents/skills')

/** A source catalog built from the real fontes.json. */
export async function loadCatalog(): Promise<SourceCatalog> {
  return new SourceCatalog(await loadSources(SKILLS_DIR))
}

/** A recorded response, as UTF-8. */
export async function fixture(name: string): Promise<string> {
  let text = await readFile(path.join(API_ROOT, 'test', 'fixtures', name), 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return text
}

/** An evidence item. The URL defaults to a page of the source. */
export function evidenceItem(
  field: Field,
  value: string,
  source: Source,
  url = `https://exemplo.pt/${source}`,
): Evidence {
  return {
    nif: '500077568',
    field,
    value,
    source,
    url,
    extractProof: `… ${value} …`,
    foundAt: '2026-10-26T10:00:00.000Z',
  }
}

/** An agent context that keeps the logged steps. */
export function recordingContext(signal = new AbortController().signal): AgentContext & { steps: string[] } {
  const steps: string[] = []
  return {
    steps,
    signal,
    log: (message) => {
      steps.push(message)
    },
  }
}

/** The usage every mock reply reports. */
export const USAGE: LanguageModelV4GenerateResult['usage'] = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

/** A plain text answer. */
export function textReply(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'STOP' },
    usage: USAGE,
    warnings: [],
  }
}

/** One tool-call part per call. The input is serialised as JSON. */
export function toolReply(...calls: { tool: string; input: unknown }[]): LanguageModelV4GenerateResult {
  return {
    content: calls.map(
      (call, index): LanguageModelV4ToolCall => ({
        type: 'tool-call',
        toolCallId: `call-${call.tool}-${index}`,
        toolName: call.tool,
        input: JSON.stringify(call.input),
      }),
    ),
    finishReason: { unified: 'tool-calls', raw: 'STOP' },
    usage: USAGE,
    warnings: [],
  }
}

export interface FakeRoute {
  match: (url: string, request: Request) => boolean
  reply: (url: string, request: Request) => Response | Promise<Response>
}

/** A stand-in for fetch that answers from a list of routes. */
export function fakeFetch(routes: FakeRoute[]): typeof fetch & { calls: { url: string; request: Request }[] } {
  const calls: { url: string; request: Request }[] = []
  const implementation = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init)
    calls.push({ url: request.url, request })
    const route = routes.find((item) => item.match(request.url, request))
    if (!route) throw new TypeError(`fetch failed: no route for ${request.url}`)
    return route.reply(request.url, request)
  }) as typeof fetch & { calls: { url: string; request: Request }[] }
  implementation.calls = calls
  return implementation
}

/** A 200 HTML response, merged with the given status and headers. */
export function html(body: string, options: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: options.status ?? 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...options.headers },
  })
}
