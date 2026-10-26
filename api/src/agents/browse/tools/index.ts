import type { AgentCache } from '../../cache.js'
import type { ContribuinteResult } from './contribuinte.js'
import { lookupContribuinte } from './contribuinte.js'
import type { PlacesResult } from './googleMaps.js'
import { searchPlaces } from './googleMaps.js'
import type { PageResult } from './page.js'
import { readPage } from './page.js'
import type { SicaeResult } from './sicae.js'
import { lookupSicae } from './sicae.js'
import type { WebSearch } from './webSearch.js'
import { createWebSearch } from './webSearch.js'
import type { WikipediaResult } from './wikipedia.js'
import { lookupWikipedia } from './wikipedia.js'

/** What the collection agent can read. Google Maps and web search exist only with their keys. */
export interface SourceTools {
  page: (url: string, signal?: AbortSignal) => Promise<PageResult>
  sicae: (nipc: string, signal?: AbortSignal) => Promise<SicaeResult>
  contribuinte: (nif: string, signal?: AbortSignal) => Promise<ContribuinteResult>
  wikipedia: (name: string, signal?: AbortSignal) => Promise<WikipediaResult>
  googleMaps?: (text: string, signal?: AbortSignal) => Promise<PlacesResult>
  webSearch?: WebSearch
}

export interface SourceToolOptions {
  cache: AgentCache
  googleMapsApiKey?: string
  tavilyApiKey?: string
}

/** Wraps every reader in the cache. A timeout is asked again; a real answer is kept. */
export function createSourceTools(options: SourceToolOptions): SourceTools {
  const keep = (value: { ok: boolean; transient?: boolean }): boolean => value.ok || value.transient !== true
  const tools: SourceTools = {
    page: (url, signal) => options.cache.remember('pagina', url, () => readPage(url, signal), keep),
    sicae: (nipc, signal) => options.cache.remember('sicae', nipc, () => lookupSicae(nipc, signal), keep),
    contribuinte: (nif, signal) =>
      options.cache.remember('contribuinte', nif, () => lookupContribuinte(nif, signal), keep),
    wikipedia: (name, signal) => options.cache.remember('wikipedia', name, () => lookupWikipedia(name, signal), keep),
  }
  if (options.googleMapsApiKey) {
    const apiKey = options.googleMapsApiKey
    tools.googleMaps = (text, signal) =>
      options.cache.remember('google-maps', text, () => searchPlaces(text, apiKey, signal), keep)
  }
  if (options.tavilyApiKey) {
    const search = createWebSearch(options.tavilyApiKey)
    tools.webSearch = (query, domains) =>
      options.cache.remember('pesquisa-web', { query, domains }, () => search(query, domains), keep)
  }
  return tools
}
