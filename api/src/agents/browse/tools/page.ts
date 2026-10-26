import { load } from 'cheerio'

import { describeFailure, fetchText } from '../../http.js'
import { hostOf } from '../../sources.js'
import { clean, type Failure } from './common.js'

/** How much of a page's text is kept for the model and the proof check. */
export const MAX_PAGE_TEXT = 8000

/** A page the agent can quote. */
export interface Page {
  ok: true
  url: string
  finalUrl: string
  redirected: boolean
  title: string
  description: string
  structuredData: Record<string, unknown>[]
  text: string
  contactLinks: string[]
}

/** A page, or a failure that still names the address asked for. */
export type PageResult = Page | (Failure & { url: string })

// These sites need a session or forbid automated collection, so the agent reads them through pesquisarWeb or googleMaps.
const BLOCKED = [
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
]

const TYPE_WORDS = ['Organization', 'Corporation', 'LocalBusiness', 'Store', 'Company', 'Place', 'PostalAddress', 'NGO']
const KEPT_KEYS = ['@type', 'name', 'legalName', 'url', 'address', 'telephone', 'email', 'taxID', 'vatID', 'sameAs', 'location']
const CONTACT_WORDS = [
  'contact',
  'contacto',
  'sobre',
  'about',
  'quem-somos',
  'empresa',
  'institucional',
  'localiza',
  'onde-estamos',
  'morada',
  'sede',
]
const BLOCKS = 'address, article, aside, blockquote, dd, div, dt, footer, h1, h2, h3, h4, h5, h6, header, li, nav, p, section, td, th, tr'

/** Whether the address is a social network or Google Maps, which this reader doesn't open. */
export function isBlocked(value: string): boolean {
  const host = hostOf(value)
  if (host === undefined) return false
  const text = value.trim()
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`
  let pathname = '/'
  try {
    pathname = new URL(withScheme).pathname
  } catch {
    pathname = '/'
  }
  if ((host === 'google.com' || host === 'google.pt') && pathname.startsWith('/maps')) return true
  return BLOCKED.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
}

/** Opens an address and returns the title, the structured data, the text and the contact links. */
export async function readPage(address: string, signal?: AbortSignal): Promise<PageResult> {
  const trimmed = address.trim()
  // "www.ctt.pt" opens as https://www.ctt.pt, so every page has an absolute URL to cite.
  const url = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (isBlocked(url)) {
    return {
      ok: false,
      url,
      error: 'Este site exige sessão ou proíbe a recolha automática: use pesquisarWeb ou googleMaps.',
    }
  }
  try {
    const response = await fetchText(url, { signal })
    if (response.status >= 400) return { ok: false, url, error: `A página respondeu ${response.status}.` }
    if (!isTextPage(response.contentType)) {
      return { ok: false, url, error: `Não é uma página de texto (${response.contentType}).` }
    }
    return {
      ok: true,
      url,
      finalUrl: response.finalUrl,
      redirected: response.redirects.length > 0,
      ...parsePage(response.text, response.finalUrl),
    }
  } catch (error) {
    return { ok: false, url, ...describeFailure(error) }
  }
}

function isTextPage(contentType: string): boolean {
  const type = contentType.toLowerCase()
  return type.includes('html') || type.includes('xml') || type.includes('text/plain')
}

/** The title, description, structured data, text and contact links of an HTML page. */
export function parsePage(html: string, baseUrl: string): Pick<Page, 'title' | 'description' | 'structuredData' | 'text' | 'contactLinks'> {
  const page = load(html)
  const structuredData: Record<string, unknown>[] = []
  page('script[type="application/ld+json"]').each((_, element) => {
    const raw = page(element).text()
    try {
      collectStructured(JSON.parse(raw), structuredData)
    } catch {
      // Invalid JSON-LD is ignored.
    }
  })

  const contactLinks: string[] = []
  page('a').each((_, element) => {
    if (contactLinks.length >= 12) return
    const link = page(element)
    const href = link.attr('href') ?? ''
    const haystack = `${href} ${link.text()}`.toLowerCase()
    if (!CONTACT_WORDS.some((word) => haystack.includes(word))) return
    let resolved: URL
    try {
      resolved = new URL(href, baseUrl)
    } catch {
      return
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return
    resolved.hash = ''
    const absolute = resolved.href
    if (!contactLinks.includes(absolute)) contactLinks.push(absolute)
  })

  page('script, style, noscript, svg, iframe, template').remove()
  page('br').replaceWith(' ')
  // Without the space, "Rua X" followed by "1000-001 Lisboa" would read "Rua X1000-001 Lisboa".
  page(BLOCKS).append(' ')
  const title = clean(page('title').first().text())
  const description = clean(page('meta[name="description"]').attr('content') ?? '')
  // Addresses usually sit in the footer or an address element, so they go first in case the text is cut.
  const text = [clean(page('address').text()), clean(page('footer').text()), clean(page('body').text())]
    .filter((part) => part.length > 0)
    .join(' ')
    .slice(0, MAX_PAGE_TEXT)
  return { title, description, structuredData: structuredData.slice(0, 5), text, contactLinks }
}

function collectStructured(node: unknown, out: Record<string, unknown>[]): void {
  if (out.length >= 5) return
  if (Array.isArray(node)) {
    for (const item of node) collectStructured(item, out)
    return
  }
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (Array.isArray(record['@graph'])) collectStructured(record['@graph'], out)
  if (out.length >= 5 || !interesting(record)) return
  const kept: Record<string, unknown> = {}
  for (const key of KEPT_KEYS) {
    if (record[key] !== undefined) kept[key] = record[key]
  }
  out.push(kept)
}

function interesting(record: Record<string, unknown>): boolean {
  const type = record['@type']
  const types = (Array.isArray(type) ? type : [type]).filter((item): item is string => typeof item === 'string')
  return types.some((item) => TYPE_WORDS.some((word) => item.includes(word))) || 'address' in record
}
