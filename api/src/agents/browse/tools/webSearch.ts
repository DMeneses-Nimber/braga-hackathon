import { tavily } from '@tavily/core'

import { describeFailure } from '../../http.js'
import type { Failure } from './common.js'

/** A public title and snippet. The score and the rest of the Tavily answer are dropped. */
export interface WebResult {
  title: string
  url: string
  content: string
}

/** The results of one search, or why it failed. */
export type WebSearchResult = { ok: true; results: WebResult[] } | Failure

/** A search of the web, optionally limited to some domains. */
export type WebSearch = (query: string, domains: string[]) => Promise<WebSearchResult>

/** Creates a Tavily search. Each search is one credit, and the client takes no abort signal. */
export function createWebSearch(apiKey: string): WebSearch {
  const client = tavily({ apiKey })
  return async (query, domains) => {
    try {
      const response = await client.search(query, {
        searchDepth: 'basic',
        maxResults: 6,
        ...(domains.length > 0 ? { includeDomains: domains } : {}),
      })
      return {
        ok: true,
        results: response.results.map((result) => ({
          title: result.title,
          url: result.url,
          content: result.content,
        })),
      }
    } catch (error) {
      return { ok: false, ...describeFailure(error) }
    }
  }
}
