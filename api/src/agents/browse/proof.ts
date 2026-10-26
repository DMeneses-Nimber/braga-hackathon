import type { Field, Source } from '../../schemas/index.js'
import { FIELD_TITLES, type SourceCatalog } from '../sources.js'

/** One item as the model handed it over, before the proof check. */
export interface EvidenceInput {
  field: Field
  value: string
  source: Source
  url: string
  extractProof: string
}

/** Every primitive inside a tool result, one per line. */
export function flattenText(value: unknown): string {
  const lines: string[] = []
  walk(value, lines)
  return lines.join('\n')
}

function walk(value: unknown, lines: string[]): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    lines.push(String(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, lines)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) walk(item, lines)
  }
}

/** Makes two excerpts comparable: quotes and extra whitespace don't count. */
export function squash(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/["'`‘’“”«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The fragment is left out: the SICAE page and its "#nipc=…" variant are the same page. */
function urlKey(value: string): string {
  const text = value.trim()
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    let host = url.hostname.toLowerCase()
    if (host.startsWith('www.')) host = host.slice(4)
    const path = url.pathname.replace(/\/+$/, '')
    return `${host}${path}${url.search}`
  } catch {
    return text.toLowerCase()
  }
}

interface Stored {
  url: string
  squashed: string
  original: string
}

/** What the tools returned in one verification, by URL. */
export class SourceRegistry {
  private readonly pages = new Map<string, Stored>()

  /** Remembers the flattened content under the URL, keeping the first URL seen for that page. */
  add(url: string, content: unknown): void {
    const key = urlKey(url)
    const flat = flattenText(content)
    const squashed = squash(flat)
    const original = flat.replace(/\s+/g, ' ').trim()
    const current = this.pages.get(key)
    if (!current) {
      this.pages.set(key, { url, squashed, original })
      return
    }
    current.squashed = current.squashed.length > 0 ? `${current.squashed}\n${squashed}` : squashed
    current.original = current.original.length > 0 ? `${current.original} ${original}` : original
  }

  /** A literal piece of the original text around the value, or undefined when it isn't there. */
  excerptAround(url: string, value: string): string | undefined {
    const stored = this.pages.get(urlKey(url))
    if (!stored) return undefined
    const needle = value.replace(/\s+/g, ' ').trim()
    if (needle.length === 0) return undefined
    const haystack = stored.original
    const index = haystack.toLowerCase().indexOf(needle.toLowerCase())
    if (index === -1) return undefined
    let start = Math.max(0, index - 60)
    let end = Math.min(haystack.length, index + needle.length + 60)
    while (start > 0 && haystack[start - 1] !== ' ') start -= 1
    while (end < haystack.length && haystack[end] !== ' ') end += 1
    const excerpt = haystack.slice(start, end).trim().slice(0, 300).trim()
    return excerpt.length > 0 ? excerpt : undefined
  }

  /** Whether anything was added under that page. */
  has(url: string): boolean {
    return this.pages.has(urlKey(url))
  }

  /** The URL as the tool returned it. */
  urlFor(url: string): string | undefined {
    return this.pages.get(urlKey(url))?.url
  }

  /** Whether the excerpt occurs in what the tool returned for that page. */
  contains(url: string, excerpt: string): boolean {
    const stored = this.pages.get(urlKey(url))
    const squashed = squash(excerpt)
    return stored !== undefined && squashed.length > 0 && stored.squashed.includes(squashed)
  }
}

export interface VerifyOptions {
  registry: SourceRegistry
  catalog: SourceCatalog
  companyHosts: ReadonlySet<string>
  log: (message: string) => void
}

/**
 * Keeps only the evidence whose excerpt appears in what a tool returned for its URL,
 * with the source worked out from the URL whenever its domain is known.
 */
export function verifyEvidence(items: EvidenceInput[], options: VerifyOptions): EvidenceInput[] {
  const kept: EvidenceInput[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const value = item.value.trim()
    const excerpt = item.extractProof.trim()
    const label = `${FIELD_TITLES[item.field]} "${value}"`
    if (value.length === 0) {
      options.log(`Evidência descartada (${label}): sem valor.`)
      continue
    }
    const url = options.registry.urlFor(item.url)
    if (url === undefined || !/^https?:\/\//i.test(url)) {
      options.log(`Evidência descartada (${label}): o URL não veio de nenhuma ferramenta.`)
      continue
    }
    let proof = excerpt
    if (excerpt.length === 0 || !options.registry.contains(url, excerpt)) {
      const recovered = options.registry.excerptAround(url, value)
      if (recovered === undefined) {
        options.log(`Evidência descartada (${label}): nem o excerto nem o valor aparecem na fonte.`)
        continue
      }
      proof = recovered
      options.log(`Excerto de ${label} trocado pelo da fonte, porque o citado não aparecia letra a letra.`)
    }
    const source = options.catalog.fromUrl(url, options.companyHosts) ?? item.source
    const duplicate = `${item.field}\u0000${source}\u0000${squash(value)}`
    if (seen.has(duplicate)) continue
    seen.add(duplicate)
    kept.push({ field: item.field, value, source, url, extractProof: proof })
  }
  return kept
}
