import { readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { insertProposals, type NewProposal } from '../src/db/proposals.js'
import { nextIds } from '../src/db/ids.js'
import {
  body,
  CTT,
  decision,
  fakeAgents,
  GROUND_TRUTH,
  postJson,
  readRuntime,
  readSummary,
  setup,
  TEST_CASE,
  type TestContext,
} from './helpers.js'

const NEW_ADDRESS = 'Rua Nova, 1, 1000-001 Lisboa'

function sampleProposal(): NewProposal {
  return {
    entity: 'CTT',
    entityId: CTT,
    field: 'address',
    currentValue: GROUND_TRUTH[CTT].address,
    newValue: NEW_ADDRESS,
    source: 'site',
    extractProof: 'Rua Nova, 1',
    verifiedAt: '2026-10-26T10:00:00.000Z',
    reason: 'Teste',
    status: 'pendente',
    rejectionReason: '',
    user: '',
  }
}

describe('the database', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it('are created on first start: the working copy from the hand-checked companies, the rest empty', async () => {
    ctx = await setup()
    expect(await readRuntime(ctx.dataDir, 'companies.json')).toEqual(GROUND_TRUTH)
    expect(await readRuntime(ctx.dataDir, 'evidence.json')).toEqual([])
    expect(await readRuntime(ctx.dataDir, 'searches.json')).toEqual([])
    expect(await readSummary(ctx.dataDir)).toEqual([])
    expect(await readRuntime(ctx.dataDir, 'schedule.json')).toEqual({
      enabled: false,
      nextRunAt: null,
      current: null,
      last: null,
    })
    const names = (await readdir(path.join(ctx.dataDir, 'runtime'))).sort()
    expect(names).toEqual(['companies.json', 'evidence.json', 'schedule.json', 'searches.json'])
  })

  it('reset loads a test case and empties the evidence, the searches and the proposals', async () => {
    ctx = await setup()
    await ctx.db.withLock(() => insertProposals(ctx!.db, [sampleProposal()]))
    await ctx.db.writeSearches([
      {
        nif: CTT,
        field: 'address',
        source: 'site',
        outcome: 'encontrado',
        urls: ['https://exemplo.invalid/site'],
        note: null,
        searchedAt: '2026-10-26T10:00:00.000Z',
      },
    ])
    const result = await ctx.db.reset('caso_teste')
    expect(result).toEqual({ dataset: 'caso_teste', companies: 3 })
    expect(await readRuntime(ctx.dataDir, 'companies.json')).toEqual(TEST_CASE)
    expect(await readRuntime(ctx.dataDir, 'evidence.json')).toEqual([])
    expect(await readRuntime(ctx.dataDir, 'searches.json')).toEqual([])
    expect(await readSummary(ctx.dataDir)).toEqual([])
  })

  it('reset refuses an unknown dataset and lists the available ones', async () => {
    ctx = await setup()
    await expect(ctx.db.reset('nao_existe')).rejects.toThrow('Disponíveis: companies, caso_teste.')
    await expect(ctx.db.reset('../companies/companies')).rejects.toThrow('não existe')
  })

  it('missing evidence and searches files are rebuilt on start', async () => {
    ctx = await setup()
    await rm(path.join(ctx.dataDir, 'runtime', 'evidence.json'))
    await rm(path.join(ctx.dataDir, 'runtime', 'searches.json'))
    await ctx.db.ensureReady()
    expect(await readRuntime(ctx.dataDir, 'evidence.json')).toEqual([])
    expect(await readRuntime(ctx.dataDir, 'searches.json')).toEqual([])
  })

  it('concurrent inserts get unique sequential ids and leave no temporary files', async () => {
    ctx = await setup()
    const created = await Promise.all(
      Array.from({ length: 10 }, () => ctx!.db.withLock(() => insertProposals(ctx!.db, [sampleProposal()]))),
    )
    expect(created.flat().map((proposal) => proposal.id).sort()).toEqual(
      Array.from({ length: 10 }, (_, index) => `p-${String(index + 1).padStart(3, '0')}`),
    )
    const runtime = await readdir(path.join(ctx.dataDir, 'runtime'))
    const summary = await readdir(path.join(ctx.dataDir, 'summary'))
    expect([...runtime, ...summary].some((name) => name.includes('.tmp'))).toBe(false)
  })

  it('summary.json is written with four spaces, like the one in the repo', async () => {
    ctx = await setup()
    await ctx.db.withLock(() => insertProposals(ctx!.db, [sampleProposal()]))
    const text = await readFile(ctx.db.paths.proposals, 'utf8')
    expect(text.startsWith('[\n    {\n        "id": "p-001",')).toBe(true)
  })

  it('is kept on start and readable, and new proposals continue its ids', async () => {
    const example = {
      id: 'p-001',
      entity: 'entityName',
      entityId: '500000000',
      field: 'address' as const,
      currentValue: 'Rua Antiga 10, 4000-000 Porto',
      newValue: 'Avenida Nova 25, 4100-000 Porto',
      source: 'VIES',
      extractProof: 'AVENIDA NOVA 25 4100-000 PORTO',
      verifiedAt: '2026-10-26T15:02:00',
      reason: 'Morada oficial diferente; empresa confirmada pelo nome.',
      status: 'pendente' as const,
      rejectionReason: 'não está certo',
      user: '',
    }
    ctx = await setup({
      summary: [example],
      agents: fakeAgents({ decisions: [decision('address', 'propor', NEW_ADDRESS)] }),
    })
    const listed = await body(await ctx.app.request('/api/propostas'))
    expect(listed).toEqual([example])
    const verified = await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    expect(verified.status).toBe(201)
    const summary = (await readSummary(ctx.dataDir)) as { id: string }[]
    expect(summary).toHaveLength(2)
    expect(summary[1]?.id).toBe('p-002')
  })

  it('are never written, even after approvals', async () => {
    ctx = await setup({
      agents: fakeAgents({ decisions: [decision('address', 'propor', NEW_ADDRESS)] }),
    })
    const before = await readFile(ctx.db.groundTruthFile, 'utf8')
    const verified = await postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    expect(verified.status).toBe(201)
    const approved = await postJson(ctx.app, '/api/propostas/p-001/aprovar')
    expect(approved.status).toBe(200)
    expect(await readFile(ctx.db.groundTruthFile, 'utf8')).toBe(before)
  })

  it('continues after the highest number with the same prefix', () => {
    expect(nextIds('p', 3, ['p-001', 'p-009', 'e-0100'], 2)).toEqual(['p-010', 'p-011'])
    expect(nextIds('e', 4, [], 1)).toEqual(['e-0001'])
  })
})
