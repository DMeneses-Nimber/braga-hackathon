import { load } from 'cheerio'

import { describeFailure, fetchText } from '../../http.js'
import { clean, type Cae, type Failure } from './common.js'

const STATUS_WORDS = [
  'activa',
  'ativa',
  'inactiva',
  'inativa',
  'cessada',
  'dissolvida',
  'insolvente',
  'em liquidação',
  'suspensa',
  'extinta',
  'encerrada',
]

/** The company page on contribuinte.pt, or why it wasn't there. */
export type ContribuinteResult =
  | {
      ok: true
      url: string
      name: string
      status: string | null
      address: string | null
      mainCae: Cae | null
      secondaryCaes: string[]
      updatedAt: string | null
    }
  | (Failure & { url: string })

/** Follows the search to the company page. A known NIF redirects to "/nif/<nif>/<name>". */
export async function lookupContribuinte(nif: string, signal?: AbortSignal): Promise<ContribuinteResult> {
  const searchUrl = `https://contribuinte.pt/search/${nif}`
  try {
    const response = await fetchText(searchUrl, { signal })
    if (response.status >= 400 || !response.finalUrl.includes(`/nif/${nif}`)) {
      return { ok: false, url: response.finalUrl, error: `O contribuinte.pt não tem a página do NIF ${nif}.` }
    }
    return { ok: true, url: response.finalUrl, ...parseContribuinte(response.text) }
  } catch (error) {
    return { ok: false, url: searchUrl, ...describeFailure(error) }
  }
}

/** The name, status, address and CAE of a contribuinte.pt company page. */
export function parseContribuinte(html: string): Omit<Extract<ContribuinteResult, { ok: true }>, 'ok' | 'url'> {
  const page = load(html)
  let status: string | null = null
  page('span').each((_, element) => {
    if (status) return
    const text = clean(page(element).text())
    const match = STATUS_WORDS.find((word) => word === text.toLowerCase())
    if (match) status = text
  })

  const location = section(page, 'Localiza')
  const paragraph = location.find('p').first()
  const street = clean(paragraph.contents().toArray().find((node) => node.type === 'text')?.data ?? '')
  // The visible code is cut short ("1999-1"); the link carries the full one.
  const postal = /\d{4}-\d{3}/.exec(location.find('a[href^="/cp/"]').attr('href') ?? '')?.[0]
  const locality = clean(location.find('a[href^="/codigo-postal/"]').first().text())
  const place = [postal, locality].filter((part) => part !== undefined && part.length > 0).join(' ')
  const address = [street, place].filter((part) => part.length > 0).join(', ')

  const activity = section(page, 'Actividade').length > 0 ? section(page, 'Actividade') : section(page, 'Atividade')
  let mainCae: Cae | null = null
  const secondaryCaes: string[] = []
  activity.find('a[href^="/cae/"]').each((_, element) => {
    const link = page(element)
    const code = /\d{5}/.exec(link.find('span').eq(0).text())?.[0]
    if (!code) return
    if (!mainCae) {
      mainCae = { code, description: clean(link.find('span').eq(1).text()) }
      return
    }
    // The site pairs the secondary codes with the wrong descriptions.
    secondaryCaes.push(code)
  })

  const updated = /Actualizado:\s*(\d{2}\/\d{2}\/\d{4})/.exec(page('body').text())
  return {
    name: clean(page('h1').first().text()),
    status,
    address: address.length > 0 ? address : null,
    mainCae,
    secondaryCaes,
    updatedAt: updated?.[1] ?? null,
  }
}

function section(page: ReturnType<typeof load>, heading: string) {
  const found = page('h2')
    .toArray()
    .find((element) => page(element).text().includes(heading))
  return found ? page(found).parent() : page.root().find('#__missing__')
}
