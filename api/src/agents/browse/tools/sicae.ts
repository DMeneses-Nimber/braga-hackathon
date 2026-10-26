import { load, type CheerioAPI } from 'cheerio'
import type { Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'

import { describeFailure, fetchText } from '../../http.js'
import { clean, type Cae, type Failure } from './common.js'

// SICAE only answers over plain HTTP and its search is an ASP.NET form.
const ENDPOINT = 'http://www.sicae.pt/Consulta.aspx'

/** What the SICAE result table says about one NIPC. */
export type SicaeResult =
  | {
      ok: true
      url: string
      nipc: string
      name: string
      mainCae: Cae | null
      secondaryCaes: Cae[]
    }
  | (Failure & { url?: string })

/** Reads the main and secondary CAE of one NIPC from the result table. */
export function parseSicaeResult(
  html: string,
  nipc: string,
): Omit<Extract<SicaeResult, { ok: true }>, 'url'> | Failure {
  const page = load(html)
  const row = page('#ctl00_MainContent_ConsultaDataGrid tr')
    .toArray()
    .find((element) => {
      const node = page(element)
      return !node.hasClass('gridHeader') && clean(node.find('td').eq(0).text()) === nipc
    })
  if (!row) return { ok: false, error: `O SICAE não tem nenhuma entidade com o NIPC ${nipc}.` }
  const cells = page(row).find('td')
  const main = readCaes(page, cells.eq(2))
  return {
    ok: true,
    nipc,
    name: clean(cells.eq(1).text()),
    mainCae: main[0] ?? null,
    secondaryCaes: readCaes(page, cells.eq(3)),
  }
}

function readCaes(page: CheerioAPI, cell: Cheerio<AnyNode>): Cae[] {
  const caes: Cae[] = []
  cell.find('div').each((_, element) => {
    const node = page(element)
    const code = /\d{5}/.exec(node.text())?.[0]
    if (!code) return
    caes.push({ code, description: clean(node.attr('title') ?? '') })
  })
  return caes
}

/** Posts the SICAE search form for one NIPC. The fragment keeps one URL per company. */
export async function lookupSicae(nipc: string, signal?: AbortSignal): Promise<SicaeResult> {
  const url = `${ENDPOINT}#nipc=${nipc}`
  try {
    const form = await fetchText(ENDPOINT, { timeoutMs: 15_000, signal })
    const fields = hiddenFields(form.text)
    fields['ctl00$MainContent$ipFirma'] = ''
    fields['ctl00$MainContent$ipNipc'] = nipc
    fields['ctl00$MainContent$ipCae'] = ''
    fields['ctl00$MainContent$btnPesquisa'] = 'Pesquisar'
    const cookie = form.cookies.map((item) => item.split(';')[0]?.trim() ?? '').filter((item) => item.length > 0)
    const posted = await fetchText(ENDPOINT, {
      method: 'POST',
      body: fields,
      headers: cookie.length > 0 ? { Cookie: cookie.join('; ') } : {},
      timeoutMs: 15_000,
      signal,
    })
    return { ...parseSicaeResult(posted.text, nipc), url }
  } catch (error) {
    return { ok: false, url, ...describeFailure(error) }
  }
}

function hiddenFields(html: string): Record<string, string> {
  const page = load(html)
  const fields: Record<string, string> = {}
  page('input[type="hidden"]').each((_, element) => {
    const name = page(element).attr('name')
    if (name) fields[name] = page(element).attr('value') ?? ''
  })
  return fields
}
