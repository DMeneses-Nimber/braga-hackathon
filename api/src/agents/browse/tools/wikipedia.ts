import { describeFailure, fetchText } from '../../http.js'
import type { Failure } from './common.js'

const API = 'https://pt.wikipedia.org/w/api.php'

/** The headquarters and website read from a Portuguese Wikipedia infobox. */
export type WikipediaResult =
  | { ok: true; url: string; title: string; headquarters: string | null; website: string | null }
  | (Failure & { url: string })

/** Searches the Portuguese Wikipedia and reads the infobox of the first article. */
export async function lookupWikipedia(name: string, signal?: AbortSignal): Promise<WikipediaResult> {
  const searchUrl = `https://pt.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`
  try {
    const search = await fetchText(apiUrl({ action: 'query', list: 'search', format: 'json', srlimit: '1', srsearch: name }), {
      signal,
    })
    const hits = JSON.parse(search.text) as { query?: { search?: { title?: string }[] } }
    const found = hits.query?.search?.[0]?.title
    if (!found) return { ok: false, url: searchUrl, error: `A Wikipedia não tem nenhum artigo para "${name}".` }
    const parsed = await fetchText(
      apiUrl({ action: 'parse', format: 'json', prop: 'wikitext', section: '0', redirects: '1', page: found }),
      { signal },
    )
    const body = JSON.parse(parsed.text) as { parse?: { title?: string; wikitext?: string | { '*'?: string } } }
    const title = body.parse?.title || found
    const wikitext = body.parse?.wikitext
    const source = typeof wikitext === 'string' ? wikitext : (wikitext?.['*'] ?? '')
    const infobox = parseInfobox(source)
    return {
      ok: true,
      url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`,
      title,
      headquarters: infobox.headquarters,
      website: infobox.website,
    }
  } catch (error) {
    // The link a person can open, not the API.
    return { ok: false, url: searchUrl, ...describeFailure(error) }
  }
}

function apiUrl(params: Record<string, string>): string {
  const query = new URLSearchParams(params)
  return `${API}?${query.toString()}`
}

/** The headquarters and website of an infobox, or null when the field is missing. */
export function parseInfobox(wikitext: string): { headquarters: string | null; website: string | null } {
  const fields = new Map<string, string>()
  for (const match of wikitext.matchAll(/^\s*\|\s*([^=]+?)\s*=\s*(.*)$/gm)) {
    const key = match[1]?.trim().toLowerCase()
    if (key && !fields.has(key)) fields.set(key, match[2] ?? '')
  }
  const headquarters = first(fields, ['sede', 'sede_principal', 'localização', 'localizacao'])
  const website = first(fields, ['página', 'pagina', 'website', 'sítio', 'sitio', 'site_oficial', 'sítio_oficial', 'url'])
  return {
    headquarters: headquarters === undefined ? null : cleanWikitext(headquarters),
    website: website === undefined ? null : websiteValue(website),
  }
}

function first(fields: Map<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = fields.get(name)
    if (value !== undefined) return value
  }
  return undefined
}

function websiteValue(raw: string): string | null {
  const url = /https?:\/\/[^\s|}\]]+/.exec(raw)?.[0]
  if (url) return url
  const cleaned = cleanWikitext(raw)
  return cleaned.length > 0 ? cleaned : null
}

/** Turns a wikitext value into the words a person would read. */
export function cleanWikitext(value: string): string {
  let text = value
  text = text.replace(/<ref\b[^>]*\/>/gi, '')
  text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
  text = text.replace(/\{\{[^{}]*\}\}/g, '')
  text = text.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
  text = text.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/gi, '$1')
  text = text.replace(/'{2,}/g, '')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/\s+/g, ' ')
  return text.replace(/^[\s,;]+|[\s,;]+$/g, '')
}
