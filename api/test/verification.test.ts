import { afterEach, describe, expect, it } from 'vitest'

import type { Agents } from '../src/agents/types.js'
import { REJECTED_QUIET_MS } from '../src/services/verification.js'
import {
  body,
  CTT,
  decision,
  deferred,
  evidence,
  fakeAgents,
  GROUND_TRUTH,
  postJson,
  PROPOSAL_KEYS,
  readRuntime,
  readSummary,
  search,
  setup,
  testClock,
  type Json,
  type TestContext,
} from './helpers.js'

const NEW_ADDRESS = 'Rua Nova, 1, 1000-001 Lisboa'

/** Reviews every pending proposal, so a later verification is allowed to run. */
async function reviewPending(ctx: TestContext): Promise<void> {
  const proposals = (await readSummary(ctx.dataDir)) as { id: string; status: string }[]
  for (const proposal of proposals) {
    if (proposal.status !== 'pendente') continue
    const response = await postJson(ctx.app, `/api/propostas/${proposal.id}/rejeitar`, { reason: 'Revista para o teste.' })
    expect(response.status).toBe(200)
  }
}

const script = {
  evidence: [evidence('address', NEW_ADDRESS), evidence('status', 'Inativa', 'googleMaps')],
  decisions: [
    decision('address', 'propor', NEW_ADDRESS),
    decision('cae', 'manter', null),
    decision('site', 'ignorar', null),
    decision('status', 'rever', 'Inativa'),
  ],
}

describe('verification without agents', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it('answers 501 and writes nothing', async () => {
    ctx = await setup()
    const response = await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    const payload = (await body(response)) as { error: { code: string } }
    expect(response.status).toBe(501)
    expect(payload.error.code).toBe('AGENTES_INDISPONIVEIS')
    expect(await readRuntime(ctx.dataDir, 'evidence.json')).toEqual([])
    expect(await readRuntime(ctx.dataDir, 'searches.json')).toEqual([])
    expect(await readSummary(ctx.dataDir)).toEqual([])
  })

  it('answers 404 for an unknown company', async () => {
    ctx = await setup()
    const response = await postJson(ctx.app, '/api/empresas/599999999/verificar')
    expect(response.status).toBe(404)
  })
})

describe('verification with agents', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it('creates proposals in summary.json only for propor and rever, in its format plus field', async () => {
    ctx = await setup({ agents: fakeAgents(script) })
    const response = await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    const payload = (await body(response)) as { proposals: Record<string, Json>[] }
    expect(response.status).toBe(201)
    expect(payload.proposals).toHaveLength(2)
    const first = payload.proposals[0]
    expect(first && Object.keys(first)).toEqual([...PROPOSAL_KEYS])
    expect(first).toMatchObject({
      id: 'p-001',
      entity: 'CTT',
      entityId: CTT,
      field: 'address',
      currentValue: GROUND_TRUTH[CTT].address,
      newValue: NEW_ADDRESS,
      source: 'site',
      extractProof: NEW_ADDRESS,
      reason: 'Teste: propor',
      status: 'pendente',
      rejectionReason: '',
      user: '',
    })
    expect(typeof first?.verifiedAt).toBe('string')
    expect(payload.proposals[1]).toMatchObject({ id: 'p-002', field: 'status', newValue: 'Inativa' })
    expect(await readSummary(ctx.dataDir)).toEqual(payload.proposals)
    expect(await readRuntime(ctx.dataDir, 'companies.json')).toEqual(GROUND_TRUTH)
  })

  it('returns every decision and the steps, and saves the evidence', async () => {
    ctx = await setup({ agents: fakeAgents(script) })
    const payload = (await body(await postJson(ctx.app, `/api/empresas/${CTT}/verificar`))) as {
      decisions: { decision: string; proposalId: string | null; currentValue: string | null }[]
      steps: { agent: string }[]
      evidence: Record<string, Json>[]
    }
    expect(payload.decisions.map((item) => [item.decision, item.proposalId])).toEqual([
      ['propor', 'p-001'],
      ['manter', null],
      ['ignorar', null],
      ['rever', 'p-002'],
    ])
    expect(payload.decisions[0]?.currentValue).toBe(GROUND_TRUTH[CTT].address)
    const agents: string[] = []
    for (const step of payload.steps) {
      if (!agents.includes(step.agent)) agents.push(step.agent)
    }
    expect(agents).toEqual(['sistema', 'recolha', 'comparacao'])
    expect(payload.evidence).toHaveLength(2)
    const foundAt = payload.evidence[0]?.foundAt
    expect(payload.evidence[0]).toEqual({
      nif: CTT,
      field: 'address',
      value: NEW_ADDRESS,
      source: 'site',
      url: 'https://exemplo.invalid/address',
      extractProof: NEW_ADDRESS,
      foundAt,
    })
    expect(typeof foundAt).toBe('string')
    expect(await readRuntime(ctx.dataDir, 'evidence.json')).toEqual(payload.evidence)
  })

  it('shows the result in the list and in the detail', async () => {
    ctx = await setup({ agents: fakeAgents(script) })
    await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    const list = (await body(await ctx.app.request('/api/empresas'))) as {
      casualName: string
      pendingProposals: number
    }[]
    expect(list[0]).toMatchObject({ casualName: 'CTT', pendingProposals: 2 })
    const detail = (await body(await ctx.app.request(`/api/empresas/${CTT}`))) as {
      evidence: unknown[]
      proposals: { id: string }[]
    }
    expect(detail.evidence).toHaveLength(2)
    expect(detail.proposals.map((proposal) => proposal.id)).toEqual(['p-002', 'p-001'])
  })

  it("replaces the company's evidence on the next verification", async () => {
    ctx = await setup({
      agents: fakeAgents(script, {
        evidence: [evidence('site', 'https://www.ctt.pt/pt')],
        decisions: [],
      }),
    })
    await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    await reviewPending(ctx)
    await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    const stored = (await readRuntime(ctx.dataDir, 'evidence.json')) as { value: string }[]
    expect(stored).toHaveLength(1)
    expect(stored[0]?.value).toBe('https://www.ctt.pt/pt')
  })

  it('saves every source searched, found or not, and shows them in the detail', async () => {
    const searches = [
      search('address', 'site', 'encontrado'),
      search('address', 'wikipedia', 'nada', 'A Wikipedia não tem nenhum artigo para "CTT".'),
      search('status', 'googleMaps', 'falhou', 'A fonte demorou demasiado a responder.'),
    ]
    ctx = await setup({
      agents: fakeAgents({ ...script, searches }, { evidence: [], searches: [], decisions: [] }),
    })
    const first = (await body(await postJson(ctx.app, `/api/empresas/${CTT}/verificar`))) as {
      searches: Record<string, Json>[]
    }
    expect(first.searches).toHaveLength(3)
    expect(first.searches.map((item) => ({ field: item.field, source: item.source, outcome: item.outcome, note: item.note }))).toEqual(
      searches.map((item) => ({ field: item.field, source: item.source, outcome: item.outcome, note: item.note })),
    )
    for (const item of first.searches) {
      expect(item.nif).toBe(CTT)
      expect(typeof item.searchedAt).toBe('string')
    }
    expect(await readRuntime(ctx.dataDir, 'searches.json')).toEqual(first.searches)
    const detail = (await body(await ctx.app.request(`/api/empresas/${CTT}`))) as { searches: Json }
    expect(detail.searches).toEqual(first.searches)
    await reviewPending(ctx)
    await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    expect(await readRuntime(ctx.dataDir, 'searches.json')).toEqual([])
  })

  it('does not run the agents while the company has proposals to review', async () => {
    let calls = 0
    const agents: Agents = {
      browse: {
        async collect(company, context) {
          calls += 1
          context.log(`Recolha de teste para ${company.casualName}.`)
          return { evidence: [evidence('address', NEW_ADDRESS)], searches: [] }
        },
      },
      compare: {
        async compare() {
          return [decision('address', 'propor', NEW_ADDRESS)]
        },
      },
    }
    ctx = await setup({ agents })
    expect((await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)).status).toBe(201)
    const second = await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    const payload = (await body(second)) as { error: { code: string; message: string } }
    expect(second.status).toBe(409)
    expect(payload.error.code).toBe('PROPOSTAS_PENDENTES')
    expect(payload.error.message).toContain('propostas por aprovar')
    const stream = await postJson(ctx.app, `/api/empresas/${CTT}/verificar/stream`)
    expect(stream.status).toBe(409)
    expect(calls).toBe(1)
    expect(await readSummary(ctx.dataDir)).toHaveLength(1)
    expect((await postJson(ctx.app, '/api/propostas/p-001/aprovar')).status).toBe(200)
    expect((await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)).status).toBe(201)
    expect(calls).toBe(2)
  })

  it('answers 500 with the steps when an agent throws, and writes nothing', async () => {
    ctx = await setup({ agents: fakeAgents({ collectError: 'Sem rede' }) })
    const response = await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    const payload = (await body(response)) as {
      error: { code: string; message: string; details: { steps: { message: string }[] } }
    }
    expect(response.status).toBe(500)
    expect(payload.error.code).toBe('VERIFICACAO_FALHOU')
    expect(payload.error.message).toContain('Sem rede')
    expect(payload.error.details.steps.at(-1)?.message).toContain('falhou')
    expect(await readRuntime(ctx.dataDir, 'evidence.json')).toEqual([])
    expect(await readSummary(ctx.dataDir)).toEqual([])
  })

  it('answers 500 when an agent returns invalid data, and writes nothing', async () => {
    ctx = await setup({
      agents: fakeAgents({ decisions: [decision('address', 'propor', null)] }),
    })
    const response = await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    const payload = (await body(response)) as { error: { message: string } }
    expect(response.status).toBe(500)
    expect(payload.error.message).toContain('newValue')
    expect(await readRuntime(ctx.dataDir, 'evidence.json')).toEqual([])
    expect(await readSummary(ctx.dataDir)).toEqual([])
  })

  it('answers 409 while the same company is being verified', async () => {
    const gate = deferred()
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const agents: Agents = {
      browse: {
        async collect(_company, context) {
          context.log('Recolha de teste para CTT.')
          started()
          await gate.promise
          return { evidence: [], searches: [] }
        },
      },
      compare: {
        async compare(_company, _evidence, context) {
          context.log('Comparação de teste.')
          return []
        },
      },
    }
    ctx = await setup({ agents })
    const pending = postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    await startedPromise
    const second = await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    const payload = (await body(second)) as { error: { code: string } }
    expect(second.status).toBe(409)
    expect(payload.error.code).toBe('VERIFICACAO_EM_CURSO')
    gate.resolve()
    expect((await pending).status).toBe(201)
  })
})

describe('a change the user rejected', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it("isn't proposed again until two weeks after it was proposed, even written another way", async () => {
    const addresses = [
      'Rua Nova, 1, 1000-001 Lisboa',
      'Rua Nova, 1, 1000-001 Lisboa',
      'RUA NOVA 1, 1000-001 LISBOA',
      'Rua Outra, 2, 1000-002 Lisboa',
      'Rua Nova, 1, 1000-001 Lisboa',
    ]
    const now = testClock('2026-10-26T10:00:00.000Z')
    ctx = await setup({
      now,
      agents: fakeAgents(
        ...addresses.map((value) => ({
          evidence: [evidence('address', value)],
          decisions: [decision('address', 'propor', value)],
        })),
      ),
    })
    const verify = () => postJson(ctx!.app, `/api/empresas/${CTT}/verificar`)
    const first = (await body(await verify())) as { proposals: { newValue: string }[] }
    expect(first.proposals).toHaveLength(1)
    expect(first.proposals[0]?.newValue).toBe(addresses[0])
    const rejected = await postJson(ctx.app, '/api/propostas/p-001/rejeitar', { reason: 'É a morada de uma loja.' })
    expect(rejected.status).toBe(200)

    const reason =
      'A mesma alteração foi rejeitada (p-001: É a morada de uma loja.). Só volta a ser proposta a partir de 09/11/2026.'
    const held =
      'Morada: esta alteração foi rejeitada (p-001); só volta a ser proposta a partir de 09/11/2026.'
    for (const _unused of [2, 3]) {
      const result = (await body(await verify())) as {
        proposals: unknown[]
        decisions: { field: string; decision: string; newValue: string | null; proposalId: string | null; reason: string }[]
        steps: { message: string }[]
      }
      expect(result.proposals).toEqual([])
      expect(result.decisions[0]).toMatchObject({
        field: 'address',
        decision: 'manter',
        newValue: null,
        proposalId: null,
        reason,
      })
      expect(result.steps.some((step) => step.message === held)).toBe(true)
    }

    const fourth = (await body(await verify())) as { proposals: { id: string; newValue: string }[] }
    expect(fourth.proposals).toEqual([expect.objectContaining({ id: 'p-002', newValue: addresses[3] })])
    now.advance(REJECTED_QUIET_MS)
    await reviewPending(ctx)
    const fifth = (await body(await verify())) as { proposals: { id: string; newValue: string }[] }
    expect(fifth.proposals).toEqual([expect.objectContaining({ id: 'p-003', newValue: addresses[0] })])
  })
})
