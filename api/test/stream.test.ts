import { afterEach, describe, expect, it } from 'vitest'

import type { Agents } from '../src/agents/types.js'
import { createApp } from '../src/app.js'
import {
  body,
  createDataDir,
  CTT,
  decision,
  deferred,
  evidence,
  fakeAgents,
  postJson,
  readSummary,
  setup,
  type Json,
  type TestContext,
} from './helpers.js'

const NEW_ADDRESS = 'Rua Nova, 1, 1000-001 Lisboa'

async function readEvents(response: Response): Promise<Json[]> {
  const text = await response.text()
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Json)
}

describe('the NDJSON stream', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it('streams each step as NDJSON, then the result, and saves the proposals', async () => {
    ctx = await setup({
      agents: fakeAgents({
        evidence: [evidence('address', NEW_ADDRESS)],
        decisions: [decision('address', 'propor', NEW_ADDRESS)],
      }),
    })
    const response = await postJson(ctx.app, `/api/empresas/${CTT}/verificar/stream`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    const events = (await readEvents(response)) as { type: string; step?: Json; result?: Json }[]
    expect(events.map((event) => event.type)).toEqual(['step', 'step', 'step', 'step', 'step', 'result'])
    expect(events[0]?.step).toMatchObject({ agent: 'sistema', message: 'Verificação de CTT iniciada.' })
    expect(events[1]?.step).toMatchObject({ agent: 'recolha', message: 'Recolha de teste para CTT.' })
    const result = events[5]?.result as { proposals: Json[]; steps: Json[] }
    expect(result.proposals).toHaveLength(1)
    expect(result.steps).toEqual(events.slice(0, 5).map((event) => event.step))
    expect(await readSummary(ctx.dataDir)).toEqual(result.proposals)
  })

  it('sends the steps while the agents are still working', async () => {
    const gate = deferred()
    const agents: Agents = {
      browse: {
        async collect(_company, context) {
          context.log('A ler o site.')
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
    const response = await postJson(ctx.app, `/api/empresas/${CTT}/verificar/stream`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('A resposta não tem corpo.')
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('A ler o site.')) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
    expect(text).not.toContain('"type":"result"')
    gate.resolve()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
    const events = text
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string })
    expect(events.at(-1)?.type).toBe('result')
  })

  it('ends with an error event when an agent fails', async () => {
    ctx = await setup({ agents: fakeAgents({ collectError: 'O site não respondeu.' }) })
    const response = await postJson(ctx.app, `/api/empresas/${CTT}/verificar/stream`)
    const events = (await readEvents(response)) as {
      type: string
      step?: { message: string }
      error?: { status: number; code: string; message: string; details: { steps: Json[] } }
    }[]
    const last = events.at(-1)
    expect(last?.type).toBe('error')
    expect(last?.error).toMatchObject({
      status: 500,
      code: 'VERIFICACAO_FALHOU',
      message: 'A verificação de CTT falhou: O site não respondeu.',
    })
    expect(Array.isArray(last?.error?.details.steps)).toBe(true)
    expect(events.at(-2)?.step?.message).toBe('A verificação falhou: O site não respondeu.')
  })

  it('answers plain JSON errors before streaming: bad NIF, unknown company, agents off, run in progress', async () => {
    ctx = await setup({ agents: fakeAgents() })
    const badNif = await postJson(ctx.app, '/api/empresas/123/verificar/stream')
    expect(badNif.status).toBe(400)
    const unknown = await postJson(ctx.app, '/api/empresas/599999999/verificar/stream')
    expect(unknown.status).toBe(404)
    const off = await setup()
    try {
      const response = await postJson(off.app, `/api/empresas/${CTT}/verificar/stream`)
      const payload = (await body(response)) as { error: { code: string } }
      expect(response.status).toBe(501)
      expect(payload.error.code).toBe('AGENTES_INDISPONIVEIS')
    } finally {
      await off.cleanup()
    }

    const gate = deferred()
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const blocking: Agents = {
      browse: {
        async collect(_company, context) {
          context.log('A ler o site.')
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
    await ctx.cleanup()
    ctx = await setup({ agents: blocking })
    const pending = postJson(ctx.app, `/api/empresas/${CTT}/verificar`)
    await startedPromise
    const streamResponse = await postJson(ctx.app, `/api/empresas/${CTT}/verificar/stream`)
    const streamBody = (await body(streamResponse)) as { error: { code: string } }
    expect(streamResponse.status).toBe(409)
    expect(streamBody.error.code).toBe('VERIFICACAO_EM_CURSO')
    gate.resolve()
    expect((await pending).status).toBe(201)
  })

  it('says the agents are off, and why, when the API has none', async () => {
    ctx = await setup()
    const response = await ctx.app.request('/api/agentes')
    const payload = (await body(response)) as { enabled: boolean; reason: string | null }
    expect(response.status).toBe(200)
    expect(payload.enabled).toBe(false)
    expect(typeof payload.reason).toBe('string')
  })

  it('reports the status it was given, and the verification uses its reason', async () => {
    const dataDir = await createDataDir()
    const status = {
      enabled: false,
      reason: 'Falta a chave do Grok.',
      models: { browse: 'grok-4.7', compare: 'grok-4.7' },
      tools: { googleMaps: false, webSearch: false },
      offline: false,
    }
    const created = await createApp({ dataDir, agentsStatus: status, weekly: { pauseMs: 0 } })
    try {
      const response = await created.app.request('/api/agentes')
      expect(await response.json()).toEqual(status)
      const verified = await postJson(created.app, `/api/empresas/${CTT}/verificar`)
      const payload = (await body(verified)) as { error: { message: string } }
      expect(payload.error.message).toBe('Falta a chave do Grok.')
    } finally {
      created.weekly.dispose()
      await created.weekly.idle()
      const { rm } = await import('node:fs/promises')
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
