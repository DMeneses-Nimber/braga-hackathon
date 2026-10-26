import { afterEach, describe, expect, it } from 'vitest'

import { body, CTT, GROUND_TRUTH, setup, type Json, type TestContext } from './helpers.js'

describe('companies', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it('lists the companies by name, with no pending proposals yet', async () => {
    ctx = await setup()
    const response = await ctx.app.request('/api/empresas')
    const list = (await body(response)) as { casualName: string; pendingProposals: number }[]
    expect(list.map((company) => company.casualName)).toEqual(['CTT', 'Galp', 'Nimber'])
    expect(list[0]).toEqual({ ...GROUND_TRUTH[CTT], pendingProposals: 0 })
  })

  it('returns the company with no evidence or proposals yet', async () => {
    ctx = await setup()
    const response = await ctx.app.request(`/api/empresas/${CTT}`)
    expect(await body(response)).toEqual({
      company: GROUND_TRUTH[CTT],
      evidence: [],
      searches: [],
      proposals: [],
    })
  })

  it('answers 404 for an unknown NIF', async () => {
    ctx = await setup()
    const response = await ctx.app.request('/api/empresas/599999999')
    const payload = (await body(response)) as { error: { code: string } }
    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('EMPRESA_NAO_ENCONTRADA')
  })

  it("answers 400 for a NIF that isn't 9 digits", async () => {
    ctx = await setup()
    const response = await ctx.app.request('/api/empresas/123')
    const payload = (await body(response)) as { error: { code: string; details: Json[] } }
    expect(response.status).toBe(400)
    expect(payload.error.code).toBe('PEDIDO_INVALIDO')
    expect(payload.error.details[0]).toEqual({ path: 'nif', message: 'O NIF tem de ter 9 dígitos.' })
  })
})
