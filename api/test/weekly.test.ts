import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Agents } from '../src/agents/types.js'
import { createApp } from '../src/app.js'
import type { AgentScript } from './helpers.js'
import {
  body,
  createDataDir,
  CTT,
  decision,
  deferred,
  evidence,
  fakeAgents,
  GALP,
  NIMBER,
  readRuntime,
  setup,
  type Json,
  type TestContext,
} from './helpers.js'

function putEnabled(app: TestContext['app'], enabled: unknown): Promise<Response> {
  return Promise.resolve(
    app.request('/api/verificacao-semanal', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  )
}

function statusOf(app: TestContext['app']): Promise<Response> {
  return Promise.resolve(app.request('/api/verificacao-semanal'))
}

function countingAgents(script: AgentScript): { agents: Agents; names: string[]; max: () => number } {
  const names: string[] = []
  let active = 0
  let highest = 0
  const inner = fakeAgents(script)
  return {
    names,
    max: () => highest,
    agents: {
      browse: {
        async collect(company, context) {
          active += 1
          highest = Math.max(highest, active)
          names.push(company.casualName)
          await new Promise((resolve) => setTimeout(resolve, 5))
          try {
            return await inner.browse.collect(company, context)
          } finally {
            active -= 1
          }
        },
      },
      compare: inner.compare,
    },
  }
}

function lisbon(iso: string): { year: number; month: number; day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    time: `${value('hour')}:${value('minute')}:${value('second')}`,
  }
}

describe('the weekly verification', () => {
  let ctx: TestContext | undefined

  afterEach(async () => {
    await ctx?.cleanup()
  })

  it('is off by default and runs nothing', async () => {
    ctx = await setup({ agents: fakeAgents() })
    expect(await body(await statusOf(ctx.app))).toEqual({
      enabled: false,
      available: true,
      reason: null,
      running: false,
      stopping: false,
      nextRunAt: null,
      current: null,
      last: null,
    })
    const response = await putEnabled(ctx.app, 'sim')
    expect(response.status).toBe(400)
  })

  it('turning it on verifies every company, one at a time, and schedules the next round a week later', async () => {
    const counted = countingAgents({
      evidence: [evidence('address', 'Rua Nova, 1, 1000-001 Lisboa')],
      decisions: [decision('address', 'propor', 'Rua Nova, 1, 1000-001 Lisboa')],
    })
    ctx = await setup({ agents: counted.agents })
    const turned = (await body(await putEnabled(ctx.app, true))) as { enabled: boolean; running: boolean }
    expect(turned.enabled).toBe(true)
    expect(turned.running).toBe(true)
    await ctx.weekly.idle()
    expect(counted.names).toEqual(['CTT', 'Galp', 'Nimber'])
    expect(counted.max()).toBe(1)
    const status = (await body(await statusOf(ctx.app))) as {
      enabled: boolean
      running: boolean
      current: null
      last: {
        startedAt: string
        total: number
        done: number
        verified: number
        skipped: number
        failures: unknown[]
        proposals: number
        interrupted: boolean
      }
      nextRunAt: string
    }
    expect(status.enabled).toBe(true)
    expect(status.running).toBe(false)
    expect(status.current).toBeNull()
    expect(status.last).toMatchObject({
      total: 3,
      done: 3,
      verified: 3,
      skipped: 0,
      failures: [],
      proposals: 3,
      interrupted: false,
    })
    const start = lisbon(status.last.startedAt)
    const next = lisbon(status.nextRunAt)
    expect(next.time).toBe(start.time)
    const days =
      (Date.UTC(next.year, next.month - 1, next.day) - Date.UTC(start.year, start.month - 1, start.day)) / 86_400_000
    expect(days).toBe(7)
    const summary = (await body(await ctx.app.request('/api/propostas?status=todas'))) as { entityId: string }[]
    expect(new Set(summary.map((proposal) => proposal.entityId))).toEqual(new Set([CTT, GALP, NIMBER]))
    const schedule = (await readRuntime(ctx.dataDir, 'schedule.json')) as { enabled: boolean; current: null }
    expect(schedule.enabled).toBe(true)
    expect(schedule.current).toBeNull()
  })

  it('turning it off lets the company being verified finish, then stops', async () => {
    const gate = deferred()
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const agents: Agents = {
      browse: {
        async collect(company, context) {
          context.log(`Recolha de teste para ${company.casualName}.`)
          if (company.casualName === 'CTT') {
            started()
            await gate.promise
          }
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
    const pending = putEnabled(ctx.app, true)
    await startedPromise
    const stopped = (await body(await putEnabled(ctx.app, false))) as {
      enabled: boolean
      running: boolean
      stopping: boolean
      nextRunAt: null
      current: { done: number; total: number; company: { nif: string; casualName: string } }
    }
    expect(stopped).toMatchObject({
      enabled: false,
      running: true,
      stopping: true,
      nextRunAt: null,
    })
    expect(stopped.current).toMatchObject({ done: 0, total: 3, company: { nif: CTT, casualName: 'CTT' } })
    gate.resolve()
    await pending
    await ctx.weekly.idle()
    const status = (await body(await statusOf(ctx.app))) as {
      enabled: boolean
      running: boolean
      stopping: boolean
      nextRunAt: null
      current: null
      last: { total: number; done: number; verified: number; interrupted: boolean }
    }
    expect(status.enabled).toBe(false)
    expect(status.running).toBe(false)
    expect(status.stopping).toBe(false)
    expect(status.nextRunAt).toBeNull()
    expect(status.current).toBeNull()
    expect(status.last).toMatchObject({ total: 3, done: 1, verified: 1, interrupted: true })
  })

  it('carries on after a company fails, and lists the failure', async () => {
    ctx = await setup({
      agents: fakeAgents({}, { collectError: 'O site não respondeu.' }, {}),
    })
    await putEnabled(ctx.app, true)
    await ctx.weekly.idle()
    const status = (await body(await statusOf(ctx.app))) as {
      last: { total: number; done: number; verified: number; skipped: number; failures: Json }
    }
    expect(status.last).toMatchObject({ total: 3, done: 3, verified: 2, skipped: 0 })
    expect(status.last.failures).toEqual([
      {
        nif: GALP,
        casualName: 'Galp',
        error: 'A verificação de Galp falhou: O site não respondeu.',
      },
    ])
  })

  it("can't be turned on while the agents are off", async () => {
    ctx = await setup()
    const response = await putEnabled(ctx.app, true)
    const payload = (await body(response)) as { error: { code: string } }
    expect(response.status).toBe(501)
    expect(payload.error.code).toBe('AGENTES_INDISPONIVEIS')
    const status = (await body(await statusOf(ctx.app))) as {
      enabled: boolean
      available: boolean
      reason: string | null
    }
    expect(status.enabled).toBe(false)
    expect(status.available).toBe(false)
    expect(typeof status.reason).toBe('string')
  })

  it('skips a company that is being verified with the button', async () => {
    const gate = deferred()
    let calls = 0
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const agents: Agents = {
      browse: {
        async collect(company, context) {
          calls += 1
          context.log(`Recolha de teste para ${company.casualName}.`)
          if (calls === 1) {
            started()
            await gate.promise
          }
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
    const manual = ctx.app.request(`/api/empresas/${CTT}/verificar`, { method: 'POST' })
    await startedPromise
    await putEnabled(ctx.app, true)
    await ctx.weekly.idle()
    const status = (await body(await statusOf(ctx.app))) as {
      last: { total: number; done: number; verified: number; skipped: number }
    }
    expect(status.last).toMatchObject({ total: 3, done: 3, verified: 2, skipped: 1 })
    gate.resolve()
    expect((await manual).status).toBe(201)
  })

  it('carries on an unfinished round after a restart', async () => {
    const dataDir = await createDataDir()
    await mkdir(path.join(dataDir, 'runtime'), { recursive: true })
    await writeFile(
      path.join(dataDir, 'runtime', 'schedule.json'),
      `${JSON.stringify(
        {
          enabled: true,
          nextRunAt: '2026-11-02T10:00:00.000Z',
          last: null,
          current: {
            startedAt: '2026-10-26T10:00:00.000Z',
            finishedAt: null,
            total: 3,
            done: 1,
            verified: 1,
            skipped: 0,
            failures: [],
            proposals: 0,
            interrupted: false,
            nifs: [CTT, GALP, NIMBER],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    const names: string[] = []
    const inner = fakeAgents({})
    const agents: Agents = {
      browse: {
        async collect(company, context) {
          names.push(company.casualName)
          return inner.browse.collect(company, context)
        },
      },
      compare: inner.compare,
    }
    const created = await createApp({ dataDir, agents, weekly: { pauseMs: 0 } })
    try {
      await created.weekly.idle()
      expect(names).toEqual(['Galp', 'Nimber'])
      const status = (await body(await created.app.request('/api/verificacao-semanal'))) as {
        last: { startedAt: string; total: number; done: number; verified: number; interrupted: boolean }
      }
      expect(status.last).toMatchObject({
        startedAt: '2026-10-26T10:00:00.000Z',
        total: 3,
        done: 3,
        verified: 3,
        interrupted: false,
      })
    } finally {
      created.weekly.dispose()
      await created.weekly.idle()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('starts the next round once the interval has passed', async () => {
    const counted = countingAgents({})
    ctx = await setup({ agents: counted.agents, weekly: { intervalMs: 300, pauseMs: 0 } })
    await putEnabled(ctx.app, true)
    await ctx.weekly.idle()
    const first = (await body(await statusOf(ctx.app))) as { last: { startedAt: string } }
    const startedAt = first.last.startedAt
    const deadline = Date.now() + 5000
    let changed = false
    while (Date.now() < deadline) {
      const current = (await body(await statusOf(ctx.app))) as { last: { startedAt: string } | null }
      if (current.last && current.last.startedAt !== startedAt) {
        changed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(changed).toBe(true)
    expect(counted.names.length).toBeGreaterThanOrEqual(6)
  })
})
