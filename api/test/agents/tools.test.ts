import { vi, afterEach, describe, expect, it } from 'vitest'

const { search } = vi.hoisted(() => ({ search: vi.fn() }))

vi.mock('@tavily/core', () => ({
  tavily: () => ({ search }),
}))

import { assertPublicUrl, fetchText } from '../../src/agents/http.js'
import { parseContribuinte, lookupContribuinte } from '../../src/agents/browse/tools/contribuinte.js'
import { parsePlaces } from '../../src/agents/browse/tools/googleMaps.js'
import { isBlocked, parsePage, readPage } from '../../src/agents/browse/tools/page.js'
import { lookupSicae, parseSicaeResult } from '../../src/agents/browse/tools/sicae.js'
import { createWebSearch } from '../../src/agents/browse/tools/webSearch.js'
import { lookupWikipedia, parseInfobox } from '../../src/agents/browse/tools/wikipedia.js'
import { fakeFetch, fixture, html } from './support.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  search.mockReset()
})

const PAGE = `<!doctype html>
<html><head>
<title>CTT | Contactos</title>
<meta name="description" content="Contactos dos CTT">
<script type="application/ld+json">{
  "@graph": [
    { "@type": "WebSite", "name": "CTT" },
    { "@type": "Organization", "name": "CTT", "url": "https://www.ctt.pt", "logo": "x.png",
      "address": { "@type": "PostalAddress", "streetAddress": "Avenida D. João II, 13", "postalCode": "1999-001" } }
  ]
}</script>
<style>.x{color:red}</style>
</head><body>
<nav>
  <a href="/contactos">Contactos</a>
  <a href="/loja">Loja</a>
  <a href="mailto:a@ctt.pt">Email contacto</a>
</nav>
<main><p>Bem-vindo</p><p>aos CTT</p></main>
<footer><p>Avenida D. João II, 13</p><p>1999-001 Lisboa</p></footer>
</body></html>`

describe('the source tools', () => {
  it('reads the main and secondary CAE from the result table', async () => {
    const parsed = parseSicaeResult(await fixture('sicae-500077568.html'), '500077568')
    expect(parsed).toMatchObject({
      ok: true,
      nipc: '500077568',
      name: 'CTT - CORREIOS DE PORTUGAL S.A.',
      mainCae: { code: '53100', description: 'Atividades postais sujeitas a obrigações de serviço universal' },
    })
    if (!parsed.ok) return
    expect(parsed.secondaryCaes.map((cae) => cae.code)).toEqual(['47126', '47401', '49410'])
  })

  it("says so when the NIPC isn't there", async () => {
    expect(parseSicaeResult(await fixture('sicae-599999999.html'), '599999999')).toEqual({
      ok: false,
      error: 'O SICAE não tem nenhuma entidade com o NIPC 599999999.',
    })
  })

  it('posts the form back with its hidden fields and session cookie', async () => {
    const fetch = fakeFetch([
      {
        match: (_url, request) => request.method === 'GET',
        reply: async () => html(await fixture('sicae-form.html'), { headers: { 'set-cookie': 'ASP.NET_SessionId=abc123; path=/; HttpOnly' } }),
      },
      {
        match: (_url, request) => request.method === 'POST',
        reply: async () => html(await fixture('sicae-500077568.html')),
      },
    ])
    globalThis.fetch = fetch
    const result = await lookupSicae('500077568')
    expect(result).toMatchObject({ ok: true, url: 'http://www.sicae.pt/Consulta.aspx#nipc=500077568' })
    if (result.ok) expect(result.mainCae?.code).toBe('53100')
    const posted = fetch.calls[1]?.request
    const form = new URLSearchParams(await posted?.text())
    expect(form.get('ctl00$MainContent$ipNipc')).toBe('500077568')
    expect(form.get('ctl00$MainContent$btnPesquisa')).toBe('Pesquisar')
    expect(form.get('__VIEWSTATE')).toBeTruthy()
    expect(form.get('__EVENTVALIDATION')).toBeTruthy()
    expect(posted?.headers.get('cookie')).toBe('ASP.NET_SessionId=abc123')
  })

  it("reports a network failure as transient, so it isn't cached", async () => {
    globalThis.fetch = fakeFetch([])
    const result = await lookupSicae('500077568')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.transient).toBe(true)
  })

  it('reads the status, the address with the full postal code and the main CAE', async () => {
    const parsed = parseContribuinte(await fixture('contribuinte-500077568.html'))
    expect(parsed.name).toBe('Ctt - Correios De Portugal S.a.')
    expect(parsed.status).toBe('Activa')
    expect(parsed.address).toBe('Avenida Dom João Ii, Nº 13, 1999-001 São José, Lisboa')
    expect(parsed.mainCae).toEqual({
      code: '53100',
      description: 'Actividades postais sujeitas a obrigações do serviço universal',
    })
    expect(parsed.secondaryCaes).toEqual(expect.arrayContaining(['47126', '49410']))
    expect(parsed.updatedAt).toBe('17/05/2026')
  })

  it("follows the search to the company page, and fails when the search doesn't land on one", async () => {
    const page = await fixture('contribuinte-500077568.html')
    globalThis.fetch = fakeFetch([
      {
        match: (url) => url.endsWith('/search/500077568'),
        reply: () => html('', { status: 301, headers: { location: '/nif/500077568/ctt-correios-de-portugal-s-a' } }),
      },
      {
        match: (url) => url.includes('/nif/500077568/'),
        reply: () => html(page),
      },
      {
        match: (url) => url.endsWith('/search/599999999'),
        reply: () => html('<h1>Pesquisa</h1>'),
      },
    ])
    const found = await lookupContribuinte('500077568')
    expect(found).toMatchObject({
      ok: true,
      url: 'https://contribuinte.pt/nif/500077568/ctt-correios-de-portugal-s-a',
      status: 'Activa',
    })
    const missing = await lookupContribuinte('599999999')
    expect(missing.ok).toBe(false)
  })

  it('finds the article and reads the head office and website from its infobox', async () => {
    const search = await fixture('wikipedia-search-ctt.json')
    const parsed = await fixture('wikipedia-parse-ctt.json')
    globalThis.fetch = fakeFetch([
      { match: (url) => url.includes('list=search'), reply: () => new Response(search, { headers: { 'content-type': 'application/json' } }) },
      { match: (url) => url.includes('action=parse'), reply: () => new Response(parsed, { headers: { 'content-type': 'application/json' } }) },
    ])
    await expect(lookupWikipedia('CTT')).resolves.toEqual({
      ok: true,
      url: 'https://pt.wikipedia.org/wiki/CTT_Correios_de_Portugal',
      title: 'CTT Correios de Portugal',
      headquarters: 'Lisboa',
      website: 'http://www.ctt.pt/',
    })
  })

  it('cleans links, templates and references out of the infobox', () => {
    const wikitext = [
      '{{Info/Empresa',
      '| sede = [[Avenida D. João II]], [[Lisboa]]<ref>Relatório</ref>',
      '| página = [https://www.ctt.pt ctt.pt]',
      '}}',
    ].join('\n')
    expect(parseInfobox(wikitext)).toEqual({
      headquarters: 'Avenida D. João II, Lisboa',
      website: 'https://www.ctt.pt',
    })
  })

  it('reads the structured data, contact links and text, footer first', () => {
    const parsed = parsePage(PAGE, 'https://www.ctt.pt/')
    expect(parsed.title).toBe('CTT | Contactos')
    expect(parsed.description).toBe('Contactos dos CTT')
    expect(parsed.structuredData).toEqual([
      {
        '@type': 'Organization',
        name: 'CTT',
        url: 'https://www.ctt.pt',
        address: { '@type': 'PostalAddress', streetAddress: 'Avenida D. João II, 13', postalCode: '1999-001' },
      },
    ])
    expect(parsed.contactLinks).toEqual(['https://www.ctt.pt/contactos'])
    expect(parsed.text.startsWith('Avenida D. João II, 13 1999-001 Lisboa')).toBe(true)
    expect(parsed.text).toContain('Bem-vindo aos CTT')
    expect(parsed.text).not.toContain('color:red')
  })

  it('never opens social networks or Google Maps', async () => {
    expect(isBlocked('https://pt.linkedin.com/company/ctt')).toBe(true)
    expect(isBlocked('https://www.instagram.com/ctt')).toBe(true)
    expect(isBlocked('https://x.com/ctt')).toBe(true)
    expect(isBlocked('https://www.google.com/maps/place/CTT')).toBe(true)
    expect(isBlocked('google.pt/maps?q=ctt')).toBe(true)
    expect(isBlocked('https://maps.app.goo.gl/abc')).toBe(true)
    expect(isBlocked('https://www.google.com/search?q=ctt')).toBe(false)
    expect(isBlocked('https://www.ctt.pt')).toBe(false)
    const fetch = fakeFetch([])
    globalThis.fetch = fetch
    const result = await readPage('https://www.facebook.com/ctt')
    expect(result.ok).toBe(false)
    expect(fetch.calls).toHaveLength(0)
  })

  it('opens an address without a scheme over https and reports redirects', async () => {
    globalThis.fetch = fakeFetch([
      {
        match: (url) => url === 'https://www.ctt.pt/',
        reply: () => html('', { status: 301, headers: { location: 'https://www.ctt.pt/particulares' } }),
      },
      { match: (url) => url === 'https://www.ctt.pt/particulares', reply: () => html(PAGE) },
    ])
    const result = await readPage('www.ctt.pt')
    expect(result).toMatchObject({
      ok: true,
      url: 'https://www.ctt.pt',
      finalUrl: 'https://www.ctt.pt/particulares',
      redirected: true,
    })
  })

  it("refuses files that aren't pages", async () => {
    globalThis.fetch = fakeFetch([
      { match: () => true, reply: () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }) },
    ])
    const result = await readPage('https://exemplo.pt/ficheiro.pdf')
    expect(result.ok).toBe(false)
  })

  it('only opens public http and https addresses', () => {
    expect(() => assertPublicUrl('file:///C:/Windows/win.ini')).toThrow()
    expect(() => assertPublicUrl('http://localhost:3000/api')).toThrow()
    expect(() => assertPublicUrl('http://192.168.1.1')).toThrow()
    expect(() => assertPublicUrl('http://[::1]/')).toThrow()
    expect(assertPublicUrl('https://www.ctt.pt').host).toBe('www.ctt.pt')
  })

  it("checks every redirect, so a page can't send it to the local network", async () => {
    globalThis.fetch = fakeFetch([
      { match: () => true, reply: () => html('', { status: 302, headers: { location: 'http://127.0.0.1:3000/' } }) },
    ])
    await expect(fetchText('https://exemplo.pt')).rejects.toThrow(/Endereço local/)
  })

  it('decodes Latin-1 pages and stops at the size cap', async () => {
    const bytes = Uint8Array.from('Praça do Comércio', (char) => char.charCodeAt(0))
    globalThis.fetch = fakeFetch([
      {
        match: () => true,
        reply: () => new Response(bytes, { headers: { 'content-type': 'text/html; charset=ISO-8859-1' } }),
      },
    ])
    const full = await fetchText('https://exemplo.pt/praca')
    expect(full.text).toBe('Praça do Comércio')
    const cut = await fetchText('https://exemplo.pt/praca', { maxBytes: 5 })
    expect(cut.text).toBe('Praça')
    expect(cut.truncated).toBe(true)
  })

  it('reads places from the Places API answer', () => {
    const places = parsePlaces(
      JSON.stringify({
        places: [
          {
            displayName: { text: 'CTT - Sede' },
            formattedAddress: 'Av. D. João II 13, 1999-001 Lisboa, Portugal',
            websiteUri: 'https://www.ctt.pt/',
            businessStatus: 'OPERATIONAL',
            googleMapsUri: 'https://maps.google.com/?cid=123',
          },
          { displayName: { text: 'Loja CTT' } },
        ],
      }),
      'CTT Lisboa',
    )
    expect(places).toEqual([
      {
        name: 'CTT - Sede',
        address: 'Av. D. João II 13, 1999-001 Lisboa, Portugal',
        website: 'https://www.ctt.pt/',
        businessStatus: 'OPERATIONAL',
        url: 'https://maps.google.com/?cid=123',
      },
      {
        name: 'Loja CTT',
        address: null,
        website: null,
        businessStatus: null,
        url: 'https://maps.google.com/?q=CTT%20Lisboa',
      },
    ])
  })

  it('searches Tavily only in the given domains', async () => {
    search.mockResolvedValueOnce({
      results: [{ title: 'CTT | LinkedIn', url: 'https://pt.linkedin.com/company/ctt', content: 'Sede: Lisboa', score: 0.9 }],
    })
    const searchWeb = createWebSearch('tvly-teste')
    await expect(searchWeb('CTT Correios', ['linkedin.com'])).resolves.toEqual({
      ok: true,
      results: [{ title: 'CTT | LinkedIn', url: 'https://pt.linkedin.com/company/ctt', content: 'Sede: Lisboa' }],
    })
    expect(search).toHaveBeenCalledWith(
      'CTT Correios',
      expect.objectContaining({ searchDepth: 'basic', maxResults: 6, includeDomains: ['linkedin.com'] }),
    )
    search.mockRejectedValueOnce(new Error('Invalid API key'))
    await expect(searchWeb('CTT', [])).resolves.toEqual({ ok: false, error: 'Invalid API key', transient: false })
  })
})
