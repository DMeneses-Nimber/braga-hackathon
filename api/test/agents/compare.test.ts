import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import { createCompareAgent } from '../../src/agents/compare/agent.js'
import { GROUND_TRUTH, CTT } from '../helpers.js'
import { evidenceItem, loadCatalog, recordingContext, textReply } from './support.js'

const company = GROUND_TRUTH[CTT]
const SICAE = 'http://www.sicae.pt/Consulta.aspx#nipc=500077568'

describe('the comparison agent', () => {
  it('keeps fields without evidence or with matching evidence, without asking the model', async () => {
    let calls = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1
        throw new Error('não devia ser chamado')
      },
    })
    const agent = createCompareAgent({ model, instructions: 'Instruções do compare-data.', sources: await loadCatalog() })
    const context = recordingContext()
    const decisions = await agent.compare(
      company,
      [
        evidenceItem('address', 'Av. D. João II, n.º 13, 1999-001 Lisboa', 'site'),
        evidenceItem('address', 'Avenida D. João II 13, 1999-001 Lisboa, Portugal', 'googleMaps'),
        evidenceItem('status', 'OPERATIONAL', 'googleMaps'),
      ],
      context,
    )
    expect(decisions.map((decision) => [decision.field, decision.decision, decision.reason])).toEqual([
      ['address', 'manter', 'Confirmado por Site da empresa, Google Maps.'],
      ['cae', 'manter', 'Sem evidência para este campo.'],
      ['site', 'manter', 'Sem evidência para este campo.'],
      ['status', 'manter', 'Confirmado por Google Maps.'],
    ])
    expect(decisions[0]).toMatchObject({ source: 'site', newValue: null })
    expect(calls).toBe(0)
  })

  it('asks the model about the fields that differ, with structured output, and applies the rules', async () => {
    const cae = evidenceItem('cae', '70100', 'sicae', SICAE)
    const site = evidenceItem('site', 'https://www.ctt-novo.pt', 'web')
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        textReply(
          JSON.stringify({
            decisoes: [
              {
                field: 'cae',
                decision: 'propor',
                newValue: '70100',
                source: 'sicae',
                url: cae.url,
                extractProof: cae.extractProof,
                reason: 'O SICAE indica 70100, talvez a conversão para a CAE-Rev.4.',
              },
              {
                field: 'site',
                decision: 'propor',
                newValue: 'https://www.ctt-novo.pt',
                source: 'web',
                url: site.url,
                extractProof: site.extractProof,
                reason: 'Um site diz outro domínio.',
              },
            ],
          }),
        ),
    })
    const agent = createCompareAgent({ model, instructions: 'Instruções do compare-data.', sources: await loadCatalog() })
    const context = recordingContext()
    const decisions = await agent.compare(company, [cae, site], context)
    expect(decisions.find((decision) => decision.field === 'cae')).toEqual({
      field: 'cae',
      decision: 'propor',
      newValue: '70100',
      source: 'sicae',
      url: cae.url,
      extractProof: cae.extractProof,
      reason: 'O SICAE indica 70100, talvez a conversão para a CAE-Rev.4.',
    })
    expect(decisions.find((decision) => decision.field === 'site')).toMatchObject({
      decision: 'rever',
      newValue: 'https://www.ctt-novo.pt',
    })
    expect(model.doGenerateCalls).toHaveLength(1)
    const call = model.doGenerateCalls[0]
    expect(call?.responseFormat).toMatchObject({ type: 'json' })
    const prompt = JSON.stringify(call?.prompt)
    expect(prompt).toContain('Instruções do compare-data.')
    expect(prompt).toContain('Decide estes campos, e só estes: cae, site.')
    expect(prompt).toContain('prioridade 1 · SICAE')
    expect(prompt).not.toContain('## Morada')
    expect(context.steps).toEqual([
      'A pedir ao Grok que decida: CAE, Website.',
      'Morada: manter.',
      'CAE: propor → 70100.',
      'Website: rever → https://www.ctt-novo.pt.',
      'Estado: manter.',
    ])
  })

  it('sends a field the model left out to a person', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textReply(JSON.stringify({ decisoes: [] })),
    })
    const agent = createCompareAgent({ model, instructions: 'Instruções do compare-data.', sources: await loadCatalog() })
    const decisions = await agent.compare(company, [evidenceItem('cae', '70100', 'sicae', SICAE)], recordingContext())
    expect(decisions.find((decision) => decision.field === 'cae')).toMatchObject({
      decision: 'rever',
      newValue: null,
      reason: 'O modelo não decidiu este campo.',
    })
  })
})
