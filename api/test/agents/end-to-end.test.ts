import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'

import { createBrowseAgent } from '../../src/agents/browse/agent.js'
import { createCompareAgent } from '../../src/agents/compare/agent.js'
import type { Agents } from '../../src/agents/types.js'
import { CTT, GROUND_TRUTH, TEST_CASE, postJson, readSummary, setup, type Json, type TestContext } from '../helpers.js'
import { loadCatalog, textReply, toolReply } from './support.js'

const ADDRESS = GROUND_TRUTH[CTT].address
const URL = 'https://www.ctt.pt/contactos'

async function readEvents(response: Response): Promise<Json[]> {
  const text = await response.text()
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Json)
}

describe('from the site to a proposal', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it('goes from the company\'s site to a pending proposal, step by step', async () => {
    const catalog = await loadCatalog()
    const browseModel = new MockLanguageModelV4({
      doGenerate: (() => {
        let step = 0
        return async () => {
          step += 1
          if (step === 1) return toolReply({ tool: 'abrirPagina', input: { url: URL, campos: ['address'] } })
          return toolReply({
            tool: 'entregarEvidencias',
            input: {
              evidencias: [{ field: 'address', value: ADDRESS, source: 'site', url: URL, extractProof: ADDRESS }],
            },
          })
        }
      })(),
    })
    const compareModel = new MockLanguageModelV4({
      doGenerate: async () =>
        textReply(
          JSON.stringify({
            decisoes: [
              {
                field: 'address',
                decision: 'propor',
                newValue: ADDRESS,
                source: 'site',
                url: URL,
                extractProof: ADDRESS,
                reason: 'O site da empresa indica outra morada para a sede.',
              },
            ],
          }),
        ),
    })
    const agents: Agents = {
      browse: createBrowseAgent({
        model: browseModel,
        instructions: 'Instruções do browse-data.',
        sources: catalog,
        maxSteps: 6,
        tools: {
          page: async (url) => ({
            ok: true,
            url,
            finalUrl: url,
            redirected: false,
            title: 'CTT | Contactos',
            description: '',
            structuredData: [],
            text: `Sede: ${ADDRESS}`,
            contactLinks: [],
          }),
          sicae: async () => ({ ok: false, error: 'Indisponível.' }),
          contribuinte: async () => ({ ok: false, url: 'https://contribuinte.pt/search/500077568', error: 'Indisponível.' }),
          wikipedia: async () => ({ ok: false, url: 'https://pt.wikipedia.org/w/index.php?search=CTT', error: 'Indisponível.' }),
        },
      }),
      compare: createCompareAgent({
        model: compareModel,
        instructions: 'Instruções do compare-data.',
        sources: catalog,
      }),
    }
    ctx = await setup({ agents })
    await ctx.db.reset('caso_teste')
    const response = await postJson(ctx.app, `/api/empresas/${CTT}/verificar/stream`)
    expect(response.status).toBe(200)
    const events = (await readEvents(response)) as { type: string; step?: { agent: string; message: string }; result?: Json }[]
    const steps = events.filter((event) => event.type === 'step').map((event) => `${event.step?.agent}: ${event.step?.message}`)
    expect(steps).toEqual([
      'sistema: Verificação de CTT iniciada.',
      'recolha: A abrir https://www.ctt.pt/contactos.',
      'recolha: 1 de 1 evidências confirmadas nas fontes.',
      'sistema: 1 evidência recolhida.',
      'comparacao: A pedir ao Grok que decida: Morada.',
      `comparacao: Morada: propor → ${ADDRESS}.`,
      'comparacao: CAE: manter.',
      'comparacao: Website: manter.',
      'comparacao: Estado: manter.',
      'sistema: 1 proposta nova criada.',
    ])
    const result = events.find((event) => event.type === 'result')?.result as {
      proposals: Json[]
      evidence: Json[]
      searches: Json[]
    }
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]).toMatchObject({
      entityId: CTT,
      field: 'address',
      currentValue: TEST_CASE[CTT].address,
      newValue: ADDRESS,
      source: 'site',
      extractProof: ADDRESS,
      status: 'pendente',
    })
    expect(result.evidence).toEqual([
      expect.objectContaining({ nif: CTT, field: 'address', source: 'site', value: ADDRESS }),
    ])
    expect(result.searches).toEqual([
      expect.objectContaining({
        nif: CTT,
        field: 'address',
        source: 'site',
        outcome: 'encontrado',
        urls: [URL],
        note: null,
      }),
    ])
    expect(await readSummary(ctx.dataDir)).toEqual(result.proposals)
  })
})
