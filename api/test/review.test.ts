import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  body,
  CTT,
  decision,
  fakeAgents,
  GALP,
  GROUND_TRUTH,
  postJson,
  readRuntime,
  setup,
  type Json,
  type TestContext,
} from './helpers.js'

const NEW_ADDRESS = 'Rua Nova, 1, 1000-001 Lisboa'

async function verified(ctx: TestContext): Promise<void> {
  const response = await postJson(
    ctx.app,
    `/api/empresas/${CTT}/verificar`,
  )
  expect(response.status).toBe(201)
}

describe('reviewing proposals', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  async function withProposals(): Promise<TestContext> {
    return setup({
      agents: fakeAgents({
        decisions: [
          decision('address', 'propor', NEW_ADDRESS),
          decision('cae', 'propor', '123'),
          decision('status', 'rever', null),
        ],
      }),
    }).then(async (created) => {
      await verified(created)
      return created
    })
  }

  it('approving changes the company and records who approved in the proposal', async () => {
    ctx = await withProposals()
    const response = await postJson(ctx.app, '/api/propostas/p-001/aprovar', { user: 'Fábio' })
    const payload = (await body(response)) as {
      proposal: { status: string; user: string; rejectionReason: string }
      company: { address: string }
    }
    expect(response.status).toBe(200)
    expect(payload.proposal).toMatchObject({ status: 'aprovada', user: 'Fábio', rejectionReason: '' })
    expect(payload.company.address).toBe(NEW_ADDRESS)
    const companies = (await readRuntime(ctx.dataDir, 'companies.json')) as Record<string, { address: string }>
    expect(companies[CTT]?.address).toBe(NEW_ADDRESS)
    const summary = JSON.parse(await readFile(ctx.db.paths.proposals, 'utf8')) as { newValue: string }[]
    expect(summary[0]?.newValue).toBe(NEW_ADDRESS)
  })

  it('approving twice answers 409', async () => {
    ctx = await withProposals()
    expect((await postJson(ctx.app, '/api/propostas/p-001/aprovar', { user: 'Fábio' })).status).toBe(200)
    const again = await postJson(ctx.app, '/api/propostas/p-001/aprovar')
    const payload = (await body(again)) as { error: { code: string } }
    expect(again.status).toBe(409)
    expect(payload.error.code).toBe('PROPOSTA_JA_REVISTA')
  })

  it('an invalid value answers 422 and changes nothing', async () => {
    ctx = await withProposals()
    const response = await postJson(ctx.app, '/api/propostas/p-002/aprovar')
    const payload = (await body(response)) as { error: { code: string } }
    expect(response.status).toBe(422)
    expect(payload.error.code).toBe('VALOR_INVALIDO')
    const companies = (await readRuntime(ctx.dataDir, 'companies.json')) as Record<string, { cae: string }>
    expect(companies[CTT]?.cae).toBe(GROUND_TRUTH[CTT].cae)
    const pending = (await body(await ctx.app.request(`/api/propostas?nif=${CTT}`))) as { id: string }[]
    expect(pending.map((proposal) => proposal.id)).toContain('p-002')
  })

  it('a proposal without a new value can only be rejected', async () => {
    ctx = await withProposals()
    const response = await postJson(ctx.app, '/api/propostas/p-003/aprovar')
    const payload = (await body(response)) as { error: { code: string } }
    expect(response.status).toBe(422)
    expect(payload.error.code).toBe('PROPOSTA_SEM_VALOR')
  })

  it('rejecting needs a reason', async () => {
    ctx = await withProposals()
    const missing = await postJson(ctx.app, '/api/propostas/p-003/rejeitar')
    const empty = await postJson(ctx.app, '/api/propostas/p-003/rejeitar', {})
    const blank = await postJson(ctx.app, '/api/propostas/p-003/rejeitar', { reason: '   ' })
    for (const response of [missing, empty, blank]) {
      const payload = (await body(response)) as { error: { code: string } }
      expect(response.status).toBe(400)
      expect(payload.error.code).toBe('PEDIDO_INVALIDO')
    }
  })

  it('rejecting closes the proposal with its reason and leaves the company alone', async () => {
    ctx = await withProposals()
    const before = await readRuntime(ctx.dataDir, 'companies.json')
    const response = await postJson(ctx.app, '/api/propostas/p-003/rejeitar', { reason: 'Fonte fraca' })
    const payload = (await body(response)) as {
      proposal: { status: string; rejectionReason: string; user: string }
    }
    expect(response.status).toBe(200)
    expect(payload.proposal).toMatchObject({ status: 'rejeitada', rejectionReason: 'Fonte fraca', user: 'anónimo' })
    expect(await readRuntime(ctx.dataDir, 'companies.json')).toEqual(before)
    const again = await postJson(ctx.app, '/api/propostas/p-003/rejeitar', { reason: 'Outra vez' })
    expect(again.status).toBe(409)
  })

  it('answers 404 for an unknown proposal and 400 for a malformed id', async () => {
    ctx = await withProposals()
    const missing = await postJson(ctx.app, '/api/propostas/p-999/aprovar')
    expect(missing.status).toBe(404)
    const malformed = await postJson(ctx.app, '/api/propostas/abc/aprovar')
    expect(malformed.status).toBe(400)
  })

  it("a body that isn't valid JSON answers 400", async () => {
    ctx = await withProposals()
    const response = await ctx.app.request('/api/propostas/p-001/rejeitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    const payload = (await body(response)) as { error: { code: string } }
    expect(response.status).toBe(400)
    expect(payload.error.code).toBe('PEDIDO_INVALIDO')
  })
})

describe('GET /api/propostas', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  async function listed(): Promise<TestContext> {
    const created = await setup({
      agents: fakeAgents({
        decisions: [
          decision('address', 'propor', NEW_ADDRESS),
          decision('site', 'propor', 'https://www.ctt.pt/pt'),
        ],
      }),
    })
    expect((await postJson(created.app, `/api/empresas/${CTT}/verificar`)).status).toBe(201)
    expect((await postJson(created.app, '/api/propostas/p-001/aprovar')).status).toBe(200)
    return created
  }

  it('lists pending proposals by default, newest first', async () => {
    ctx = await listed()
    const proposals = (await body(await ctx.app.request('/api/propostas'))) as { id: string }[]
    expect(proposals.map((proposal) => proposal.id)).toEqual(['p-002'])
  })

  it('filters by status and NIF', async () => {
    ctx = await listed()
    const all = (await body(await ctx.app.request('/api/propostas?status=todas'))) as { id: string }[]
    expect(all.map((proposal) => proposal.id)).toEqual(['p-002', 'p-001'])
    const approved = (await body(await ctx.app.request('/api/propostas?status=aprovada'))) as { id: string }[]
    expect(approved.map((proposal) => proposal.id)).toEqual(['p-001'])
    const galp = (await body(await ctx.app.request(`/api/propostas?status=todas&nif=${GALP}`))) as unknown[]
    expect(galp).toEqual([])
  })

  it('answers 400 for an unknown status', async () => {
    ctx = await listed()
    const response = await ctx.app.request('/api/propostas?status=xpto')
    expect(response.status).toBe(400)
  })
})

describe('a stale proposal', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it('answers 409 when the company changed since the proposal was made', async () => {
    ctx = await setup({
      agents: fakeAgents(
        { decisions: [decision('address', 'propor', 'Rua A, 1, 1000-001 Lisboa')] },
        { decisions: [decision('address', 'propor', 'Rua B, 2, 1000-002 Lisboa')] },
      ),
    })
    expect((await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)).status).toBe(201)
    expect((await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)).status).toBe(201)
    const first = await postJson(ctx.app, '/api/propostas/p-001/aprovar')
    const approved = (await body(first)) as { proposal: { user: string } }
    expect(first.status).toBe(200)
    expect(approved.proposal.user).toBe('anónimo')
    const second = await postJson(ctx.app, '/api/propostas/p-002/aprovar')
    const payload = (await body(second)) as { error: { code: string; details: Json } }
    expect(second.status).toBe(409)
    expect(payload.error.code).toBe('PROPOSTA_DESATUALIZADA')
    expect(payload.error.details).toEqual({
      proposalCurrentValue: GROUND_TRUTH[CTT].address,
      currentValue: 'Rua A, 1, 1000-001 Lisboa',
    })
  })
})
