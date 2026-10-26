import { APICallError, RetryError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import { createBrowseAgent, type BrowseAgentOptions } from '../../src/agents/browse/agent.js'
import type { PageResult } from '../../src/agents/browse/tools/page.js'
import type { SourceTools } from '../../src/agents/browse/tools/index.js'
import { CTT, GALP, GROUND_TRUTH, NIMBER } from '../helpers.js'
import { loadCatalog, recordingContext, textReply, toolReply } from './support.js'

const ADDRESS = 'Avenida D. João II, 13, 1999-001 Lisboa'
const SICAE = 'http://www.sicae.pt/Consulta.aspx#nipc=500077568'

function page(url: string, finalUrl = url, text = `Sede: ${ADDRESS}. Contactos.`): PageResult {
  return {
    ok: true,
    url,
    finalUrl,
    redirected: finalUrl !== url,
    title: 'CTT',
    description: '',
    structuredData: [],
    text,
    contactLinks: [],
  }
}

function sicaeResult(nipc: string) {
  return {
    ok: true as const,
    url: `http://www.sicae.pt/Consulta.aspx#nipc=${nipc}`,
    nipc,
    name: 'CTT - CORREIOS DE PORTUGAL S.A.',
    mainCae: { code: '53100', description: 'Atividades postais sujeitas a obrigações de serviço universal' },
    secondaryCaes: [] as { code: string; description: string }[],
  }
}

function baseTools(extra: Partial<SourceTools> = {}): SourceTools {
  return {
    page: async (url) => page(url),
    sicae: async (nipc) => sicaeResult(nipc),
    contribuinte: async () => ({ ok: false, url: 'https://contribuinte.pt/search/x', error: 'Sem página.' }),
    wikipedia: async () => ({ ok: false, url: 'https://pt.wikipedia.org/w/api.php', error: 'Sem artigo.' }),
    ...extra,
  }
}

function collector(
  model: MockLanguageModelV4,
  sourceTools: SourceTools,
  sources: BrowseAgentOptions['sources'],
  overrides: Partial<BrowseAgentOptions> = {},
) {
  return createBrowseAgent({
    model,
    instructions: 'Instruções do browse-data.',
    sources,
    tools: sourceTools,
    maxSteps: 8,
    ...overrides,
  })
}

function toolNames(call: { tools?: { name: string }[] } | undefined): string[] {
  return (call?.tools ?? []).map((item) => item.name)
}

function systemText(message: { role?: string; content?: unknown } | undefined): string {
  if (!message || message.role !== 'system') return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
    .join('')
}

describe('the collection agent', () => {
  it('runs the tools the model asks for and keeps only evidence the sources show', async () => {
    const catalog = await loadCatalog()
    const seen: { url?: string; nipc?: string }[] = []
    const sourceTools = baseTools({
      page: async (url) => {
        seen.push({ url })
        return page(url)
      },
      sicae: async (nipc) => {
        seen.push({ nipc })
        return sicaeResult(nipc)
      },
    })
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) {
          return toolReply(
            { tool: 'abrirPagina', input: { url: 'https://www.ctt.pt', campos: ['address'] } },
            { tool: 'sicae', input: { nipc: '500077568' } },
          )
        }
        return toolReply({
          tool: 'entregarEvidencias',
          input: {
            evidencias: [
              { field: 'address', value: ADDRESS, source: 'web', url: 'https://www.ctt.pt/', extractProof: ADDRESS },
              { field: 'cae', value: '53100', source: 'sicae', url: SICAE, extractProof: '53100' },
              { field: 'site', value: 'https://www.ctt.pt', source: 'linkedin', url: 'https://pt.linkedin.com/company/ctt', extractProof: 'ctt.pt' },
              { field: 'status', value: 'Ativa', source: 'site', url: 'https://www.ctt.pt', extractProof: 'Empresa ativa desde 1520' },
            ],
          },
        })
      },
    })
    const context = recordingContext()
    const result = await collector(model, sourceTools, catalog).collect(GROUND_TRUTH[CTT], context)
    expect(result.evidence.map(({ field, value, source, url, extractProof }) => ({ field, value, source, url, extractProof }))).toEqual([
      { field: 'address', value: ADDRESS, source: 'site', url: 'https://www.ctt.pt', extractProof: ADDRESS },
      { field: 'cae', value: '53100', source: 'sicae', url: SICAE, extractProof: '53100' },
    ])
    expect(result.searches).toEqual([
      { field: 'address', source: 'site', outcome: 'encontrado', urls: ['https://www.ctt.pt'], note: null },
      { field: 'cae', source: 'sicae', outcome: 'encontrado', urls: [SICAE], note: null },
    ])
    expect(seen).toEqual([{ url: 'https://www.ctt.pt' }, { nipc: '500077568' }])
    expect(context.steps).toEqual([
      'A abrir https://www.ctt.pt.',
      'A consultar o SICAE (NIPC 500077568).',
      'Evidência descartada (Website "https://www.ctt.pt"): o URL não veio de nenhuma ferramenta.',
      'Evidência descartada (Estado "Ativa"): nem o excerto nem o valor aparecem na fonte.',
      '2 de 4 evidências confirmadas nas fontes.',
    ])
    const call = model.doGenerateCalls[0]
    expect(systemText(call?.prompt[0])).toBe('Instruções do browse-data.')
    expect(JSON.stringify(call?.prompt)).toContain('NIF: 500077568')
    expect(toolNames(call)).toEqual(['abrirPagina', 'sicae', 'contribuinte', 'wikipedia', 'entregarEvidencias'])
  })

  it('records every source searched for each field, found or not', async () => {
    const catalog = await loadCatalog()
    const sourceTools = baseTools({
      wikipedia: async () => ({
        ok: false,
        url: 'https://pt.wikipedia.org/w/index.php?search=CTT',
        error: 'A Wikipedia não tem nenhum artigo para "CTT".',
      }),
      googleMaps: async () => ({ ok: false, error: 'A fonte demorou demasiado a responder.', transient: true }),
    })
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) return toolReply({ tool: 'abrirPagina', input: { url: 'https://www.ctt.pt', campos: ['address', 'site'] } })
        if (step === 2) return toolReply({ tool: 'sicae', input: { nipc: '500077568' } })
        if (step === 3) return toolReply({ tool: 'wikipedia', input: { nome: 'CTT', campos: ['address'] } })
        if (step === 4) return toolReply({ tool: 'googleMaps', input: { texto: 'CTT Lisboa', campos: ['status'] } })
        return toolReply({
          tool: 'entregarEvidencias',
          input: {
            evidencias: [
              { field: 'address', value: ADDRESS, source: 'web', url: 'https://www.ctt.pt/', extractProof: ADDRESS },
              { field: 'cae', value: '53100', source: 'sicae', url: SICAE, extractProof: '53100' },
            ],
          },
        })
      },
    })
    const result = await collector(model, sourceTools, catalog).collect(GROUND_TRUTH[CTT], recordingContext())
    expect(result.searches).toEqual([
      { field: 'address', source: 'site', outcome: 'encontrado', urls: ['https://www.ctt.pt'], note: null },
      { field: 'site', source: 'site', outcome: 'nada', urls: ['https://www.ctt.pt'], note: null },
      { field: 'cae', source: 'sicae', outcome: 'encontrado', urls: [SICAE], note: null },
      {
        field: 'address',
        source: 'wikipedia',
        outcome: 'nada',
        urls: ['https://pt.wikipedia.org/w/index.php?search=CTT'],
        note: 'A Wikipedia não tem nenhum artigo para "CTT".',
      },
      { field: 'status', source: 'googleMaps', outcome: 'falhou', urls: [], note: 'A fonte demorou demasiado a responder.' },
    ])
  })

  it('counts every domain a web search was limited to as searched', async () => {
    const catalog = await loadCatalog()
    const sourceTools = baseTools({
      webSearch: async () => ({
        ok: true,
        results: [{ title: 'CTT | LinkedIn', url: 'https://pt.linkedin.com/company/ctt', content: 'Website: https://www.ctt.pt' }],
      }),
    })
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) {
          return toolReply({
            tool: 'pesquisarWeb',
            input: { consulta: 'CTT', dominios: ['linkedin.com', 'facebook.com'], campos: ['site'] },
          })
        }
        return toolReply({
          tool: 'entregarEvidencias',
          input: {
            evidencias: [
              {
                field: 'site',
                value: 'https://www.ctt.pt',
                source: 'linkedin',
                url: 'https://pt.linkedin.com/company/ctt',
                extractProof: 'Website: https://www.ctt.pt',
              },
            ],
          },
        })
      },
    })
    const result = await collector(model, sourceTools, catalog).collect(GROUND_TRUTH[CTT], recordingContext())
    expect(result.searches.map(({ field, source, outcome }) => [field, source, outcome])).toEqual([
      ['site', 'linkedin', 'encontrado'],
      ['site', 'facebook', 'nada'],
    ])
  })

  it('forces the hand-over on the last step', async () => {
    const catalog = await loadCatalog()
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) return toolReply({ tool: 'abrirPagina', input: { url: 'https://www.ctt.pt', campos: ['address'] } })
        return toolReply({ tool: 'entregarEvidencias', input: { evidencias: [] } })
      },
    })
    await collector(model, baseTools(), catalog, { maxSteps: 2 }).collect(GROUND_TRUTH[CTT], recordingContext())
    expect(model.doGenerateCalls[0]?.toolChoice).toEqual({ type: 'auto' })
    expect(model.doGenerateCalls[1]?.toolChoice).toEqual({ type: 'tool', toolName: 'entregarEvidencias' })
  })

  it('asks once more for the hand-over when the model stops with a plain answer', async () => {
    const catalog = await loadCatalog()
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) return toolReply({ tool: 'abrirPagina', input: { url: 'https://www.ctt.pt', campos: ['address'] } })
        if (step === 2) return textReply('A sede é na Avenida D. João II.')
        return toolReply({
          tool: 'entregarEvidencias',
          input: {
            evidencias: [{ field: 'address', value: ADDRESS, source: 'site', url: 'https://www.ctt.pt', extractProof: ADDRESS }],
          },
        })
      },
    })
    const context = recordingContext()
    const result = await collector(model, baseTools(), catalog).collect(GROUND_TRUTH[CTT], context)
    expect(result.evidence.map((item) => item.source)).toEqual(['site'])
    expect(context.steps).toContain('O agente parou sem entregar a evidência (STOP); a pedir a entrega.')
    const retry = model.doGenerateCalls[2]
    expect(retry?.toolChoice).toEqual({ type: 'tool', toolName: 'entregarEvidencias' })
    expect(toolNames(retry)).toEqual(['entregarEvidencias'])
    expect(JSON.stringify(retry?.prompt)).toContain(`Sede: ${ADDRESS}`)
  })

  it('returns no evidence, without failing, when the model ignores the hand-over twice', async () => {
    const catalog = await loadCatalog()
    let calls = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1
        return textReply('Não encontrei nada.')
      },
    })
    const context = recordingContext()
    const result = await collector(model, baseTools(), catalog).collect(GROUND_TRUTH[CTT], context)
    expect(result).toEqual({ evidence: [], searches: [] })
    expect(calls).toBe(2)
    expect(context.steps).toContain('O agente terminou sem entregar evidência.')
  })

  it('keeps evidence cited without the URL fragment or quoted loosely, with the source\'s own words', async () => {
    const catalog = await loadCatalog()
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) {
          return toolReply(
            { tool: 'sicae', input: { nipc: '500077568' } },
            { tool: 'abrirPagina', input: { url: 'https://www.ctt.pt', campos: ['status'] } },
          )
        }
        return toolReply({
          tool: 'entregarEvidencias',
          input: {
            evidencias: [
              { field: 'cae', value: '53100', source: 'sicae', url: 'http://www.sicae.pt/Consulta.aspx', extractProof: 'CAE principal: 53100' },
              { field: 'status', value: 'Ativa', source: 'site', url: 'https://www.ctt.pt', extractProof: 'Empresa ativa' },
            ],
          },
        })
      },
    })
    const context = recordingContext()
    const result = await collector(model, baseTools(), catalog).collect(GROUND_TRUTH[CTT], context)
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]).toMatchObject({ field: 'cae', value: '53100', source: 'sicae', url: SICAE })
    expect(result.evidence[0]?.extractProof).toContain('53100 Atividades postais sujeitas a obrigações')
    expect(context.steps).toContain('Excerto de CAE "53100" trocado pelo da fonte, porque o citado não aparecia letra a letra.')
    expect(context.steps).toContain('Evidência descartada (Estado "Ativa"): nem o excerto nem o valor aparecem na fonte.')
  })

  it("counts the domain the stored site redirects to as the company's site", async () => {
    const catalog = await loadCatalog()
    const sourceTools = baseTools({
      page: async (url) => page(url, 'https://www.nimbertech.pt/', 'Rua do Polo Norte, 14, 1990-266 Lisboa'),
    })
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) return toolReply({ tool: 'abrirPagina', input: { url: 'https://nimber.pt', campos: ['address'] } })
        return toolReply({
          tool: 'entregarEvidencias',
          input: {
            evidencias: [
              {
                field: 'address',
                value: 'Rua do Polo Norte, 14, 1990-266 Lisboa',
                source: 'web',
                url: 'https://www.nimbertech.pt/',
                extractProof: 'Rua do Polo Norte, 14, 1990-266 Lisboa',
              },
            ],
          },
        })
      },
    })
    const context = recordingContext()
    const result = await collector(model, sourceTools, catalog).collect(GROUND_TRUTH[NIMBER], context)
    expect(result.evidence[0]?.source).toBe('site')
    expect(context.steps).toContain('O site guardado redireciona para https://www.nimbertech.pt/.')
  })

  it("counts another domain as the company's site only when another source confirms it", async () => {
    const catalog = await loadCatalog()
    const sourceTools = baseTools({
      webSearch: async () => ({
        ok: true,
        results: [{ title: 'Galp | LinkedIn', url: 'https://pt.linkedin.com/company/galp', content: 'Website: https://www.galp.pt' }],
      }),
      page: async (url) => page(url, url, `Sede: ${ADDRESS}`),
    })
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) {
          return toolReply(
            { tool: 'abrirPagina', input: { url: 'https://www.ctt.pt', campos: ['address'] } },
            { tool: 'abrirPagina', input: { url: 'https://www.galp.pt', campos: ['address'] } },
            { tool: 'pesquisarWeb', input: { consulta: 'Galp', dominios: ['linkedin.com'], campos: ['site'] } },
          )
        }
        return toolReply({
          tool: 'entregarEvidencias',
          input: {
            evidencias: [
              { field: 'site', value: 'https://www.ctt.pt', source: 'site', url: 'https://www.ctt.pt', extractProof: 'CTT' },
              { field: 'address', value: ADDRESS, source: 'site', url: 'https://www.ctt.pt', extractProof: `Sede: ${ADDRESS}` },
              {
                field: 'site',
                value: 'https://www.galp.pt',
                source: 'linkedin',
                url: 'https://pt.linkedin.com/company/galp',
                extractProof: 'Website: https://www.galp.pt',
              },
              { field: 'address', value: ADDRESS, source: 'site', url: 'https://www.galp.pt', extractProof: `Sede: ${ADDRESS}` },
            ],
          },
        })
      },
    })
    const result = await collector(model, sourceTools, catalog).collect(GROUND_TRUTH[GALP], recordingContext())
    expect(result.evidence.map(({ field, url, source }) => [field, url, source])).toEqual([
      ['site', 'https://www.ctt.pt', 'web'],
      ['address', 'https://www.ctt.pt', 'web'],
      ['site', 'https://pt.linkedin.com/company/galp', 'linkedin'],
      ['address', 'https://www.galp.pt', 'site'],
    ])
  })

  it('offers Google Maps and web search only with their keys, within the limits', async () => {
    const catalog = await loadCatalog()
    let maps = 0
    const sourceTools = baseTools({
      googleMaps: async () => {
        maps += 1
        return {
          ok: true,
          places: [{ name: 'CTT', address: ADDRESS, website: 'https://www.ctt.pt/', businessStatus: 'OPERATIONAL', url: 'https://maps.google.com/?cid=1' }],
        }
      },
      webSearch: async () => ({ ok: true, results: [] }),
    })
    let step = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1
        if (step === 1) {
          return toolReply(
            { tool: 'googleMaps', input: { texto: 'CTT Lisboa', campos: ['status'] } },
            { tool: 'googleMaps', input: { texto: 'CTT sede', campos: ['status'] } },
          )
        }
        return toolReply({
          tool: 'entregarEvidencias',
          input: {
            evidencias: [
              {
                field: 'status',
                value: 'OPERATIONAL',
                source: 'googleMaps',
                url: 'https://maps.google.com/?cid=1',
                extractProof: 'OPERATIONAL',
              },
            ],
          },
        })
      },
    })
    const result = await collector(model, sourceTools, catalog, { limits: { googleMaps: 1, webSearch: 1 } }).collect(
      GROUND_TRUTH[CTT],
      recordingContext(),
    )
    expect(toolNames(model.doGenerateCalls[0])).toContain('pesquisarWeb')
    expect(maps).toBe(1)
    expect(result.evidence).toEqual([
      {
        field: 'status',
        value: 'OPERATIONAL',
        source: 'googleMaps',
        url: 'https://maps.google.com/?cid=1',
        extractProof: 'OPERATIONAL',
      },
    ])
  })
})

describe('with high demand on its model', () => {
  const demand = new APICallError({
    message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.',
    url: 'https://generativelanguage.googleapis.com',
    requestBodyValues: {},
    statusCode: 503,
    isRetryable: false,
  })

  const handed = {
    evidencias: [{ field: 'address', value: ADDRESS, source: 'site', url: 'https://www.ctt.pt', extractProof: ADDRESS }],
  }

  it('collects that company with the comparison model, and goes back to its own for the next', async () => {
    const catalog = await loadCatalog()
    let usual = 0
    const usualModel = new MockLanguageModelV4({
      modelId: 'grok-recolha',
      doGenerate: async () => {
        usual += 1
        if (usual === 1) {
          throw new RetryError({ message: 'Failed after 3 attempts.', reason: 'maxRetriesExceeded', errors: [demand] })
        }
        if (usual === 2) return toolReply({ tool: 'abrirPagina', input: { url: 'https://www.ctt.pt', campos: ['address'] } })
        return toolReply({ tool: 'entregarEvidencias', input: handed })
      },
    })
    let fallbackCalls = 0
    const fallback = new MockLanguageModelV4({
      modelId: 'grok-comparacao',
      doGenerate: async () => {
        fallbackCalls += 1
        if (fallbackCalls === 1) return toolReply({ tool: 'abrirPagina', input: { url: 'https://www.ctt.pt', campos: ['address'] } })
        return toolReply({ tool: 'entregarEvidencias', input: handed })
      },
    })
    const agent = createBrowseAgent({
      model: usualModel,
      fallbackModel: fallback,
      instructions: 'Instruções do browse-data.',
      sources: catalog,
      tools: baseTools(),
      maxSteps: 8,
    })
    const context = recordingContext()
    const first = await agent.collect(GROUND_TRUTH[CTT], context)
    expect(first.evidence[0]?.source).toBe('site')
    expect(context.steps).toContain('O modelo grok-recolha está com muita procura; esta empresa segue com grok-comparacao.')
    expect(fallbackCalls).toBe(2)
    const second = await agent.collect(GROUND_TRUTH[GALP], recordingContext())
    expect(second.evidence).toHaveLength(1)
    expect(usual).toBe(3)
    expect(fallbackCalls).toBe(2)
  })

  it('fails, as before, when the comparison model has high demand too', async () => {
    const catalog = await loadCatalog()
    const failing = () => new MockLanguageModelV4({ doGenerate: async () => { throw demand } })
    const agent = createBrowseAgent({
      model: failing(),
      fallbackModel: failing(),
      instructions: 'Instruções do browse-data.',
      sources: catalog,
      tools: baseTools(),
      maxSteps: 8,
    })
    await expect(agent.collect(GROUND_TRUTH[CTT], recordingContext())).rejects.toThrow(/high demand/)
  })

  it("doesn't switch for other errors", async () => {
    const catalog = await loadCatalog()
    let fallbackCalls = 0
    const agent = createBrowseAgent({
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          throw new APICallError({
            message: 'API key not valid.',
            url: 'https://generativelanguage.googleapis.com',
            requestBodyValues: {},
            statusCode: 400,
            isRetryable: false,
          })
        },
      }),
      fallbackModel: new MockLanguageModelV4({
        doGenerate: async () => {
          fallbackCalls += 1
          return textReply('não')
        },
      }),
      instructions: 'Instruções do browse-data.',
      sources: catalog,
      tools: baseTools(),
      maxSteps: 8,
    })
    await expect(agent.collect(GROUND_TRUTH[CTT], recordingContext())).rejects.toThrow(/API key not valid/)
    expect(fallbackCalls).toBe(0)
  })
})
