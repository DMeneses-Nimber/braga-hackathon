import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Hono } from 'hono'

import type { Agents, AgentContext } from '../src/agents/types.js'
import type { Database } from '../src/db/database.js'
import type {
  CollectedEvidence,
  CollectedSearch,
  Decision,
  Field,
  FieldDecision,
  Proposal,
  SearchOutcome,
  Source,
} from '../src/schemas/index.js'
import { createApp } from '../src/app.js'
import type { WeeklyVerificationService } from '../src/services/weekly.js'

/** CTT's NIF. */
export const CTT = '500077568'

/** Galp's NIF. */
export const GALP = '505060515'

/** Nimber's NIF. */
export const NIMBER = '517157721'

/** Three companies, with each status kept as the literal "Ativa". */
export const GROUND_TRUTH = {
  [CTT]: {
    casualName: 'CTT',
    nif: CTT,
    name: 'CTT - Correios de Portugal, S.A.',
    address: 'Avenida D. João II, 13, 1999-001 Lisboa',
    site: 'https://www.ctt.pt',
    cae: '53100',
    status: 'Ativa' as const,
  },
  [GALP]: {
    casualName: 'Galp',
    nif: GALP,
    name: 'Galp Energia, S.A.',
    address: 'Avenida da Índia, 8, 1349-065 Lisboa',
    site: 'https://www.galp.com/pt',
    cae: '64202',
    status: 'Ativa' as const,
  },
  [NIMBER]: {
    casualName: 'Nimber',
    nif: NIMBER,
    name: 'NIMBERTECH - IT SOLUTIONS, LDA',
    address: 'Rua do Polo Norte Nº14 piso 1.2 1990-266 - Parque das Nações - Lisboa',
    site: 'https://nimber.pt',
    cae: '62010',
    status: 'Ativa' as const,
  },
}

/** A test case where the CTT address is wrong. */
export const TEST_CASE = {
  ...GROUND_TRUTH,
  [CTT]: {
    ...GROUND_TRUTH[CTT],
    address: 'Rua de São José, 20, 1150-321 Lisboa',
  },
}

/** Loosely typed JSON in tests. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** What setup returns. */
export interface TestContext {
  app: Hono
  db: Database
  dataDir: string
  weekly: WeeklyVerificationService
  cleanup: () => Promise<void>
}

/** A clock that moves one second forward on every call. The first call is one second after the start. */
export interface MovingClock {
  (): Date
  advance(milliseconds: number): void
}

/** Creates a clock starting at the given instant. */
export function testClock(start = '2026-10-26T10:00:00.000Z'): MovingClock {
  let current = Date.parse(start)
  const clock = (() => {
    current += 1000
    return new Date(current)
  }) as MovingClock
  clock.advance = (milliseconds: number) => {
    current += milliseconds
  }
  return clock
}

/** A temporary data folder with the ground truth and one test case. */
export async function createDataDir(options: { summary?: Proposal[] } = {}): Promise<string> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dia-api-'))
  await writeJson(path.join(dataDir, 'companies', 'companies.json'), GROUND_TRUTH)
  await writeJson(path.join(dataDir, 'tests', 'input', 'caso_teste.json'), TEST_CASE)
  if (options.summary) await writeJson(path.join(dataDir, 'summary', 'summary.json'), options.summary)
  return dataDir
}

/** An app on a temporary data folder. The weekly pause is zero unless a test overrides it. */
export async function setup(
  options: {
    agents?: Agents
    summary?: Proposal[]
    weekly?: { intervalMs?: number; pauseMs?: number }
    now?: () => Date
  } = {},
): Promise<TestContext> {
  const dataDir = await createDataDir({ summary: options.summary })
  try {
    const created = await createApp({
      dataDir,
      agents: options.agents,
      now: options.now ?? testClock(),
      weekly: { pauseMs: 0, ...options.weekly },
    })
    return {
      app: created.app,
      db: created.db,
      dataDir,
      weekly: created.weekly,
      cleanup: async () => {
        created.weekly.dispose()
        await created.weekly.idle()
        await rm(dataDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(dataDir, { recursive: true, force: true })
    throw error
  }
}

/** The JSON body of a response. */
export async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json
}

/** One file of the working copy, parsed. */
export async function readRuntime(dataDir: string, file: string): Promise<Json> {
  return JSON.parse(await readFile(path.join(dataDir, 'runtime', file), 'utf8')) as Json
}

/** The proposals file, parsed. */
export async function readSummary(dataDir: string): Promise<Json> {
  return JSON.parse(await readFile(path.join(dataDir, 'summary', 'summary.json'), 'utf8')) as Json
}

/** The 13 proposal keys, in the order summary.json writes them. */
export const PROPOSAL_KEYS = [
  'id',
  'entity',
  'entityId',
  'field',
  'currentValue',
  'newValue',
  'source',
  'extractProof',
  'verifiedAt',
  'reason',
  'status',
  'rejectionReason',
  'user',
] as const

/** A POST. A JSON content type and body are sent only when a payload is given. */
export function postJson(app: Hono, url: string, payload?: unknown): Promise<Response> {
  if (arguments.length < 3) return Promise.resolve(app.request(url, { method: 'POST' }))
  return Promise.resolve(
    app.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

/** A collected evidence item. The URL and the excerpt come from the field and the value. */
export function evidence(field: Field, value: string, source: Source = 'site'): CollectedEvidence {
  return {
    field,
    value,
    source,
    url: `https://exemplo.invalid/${field}`,
    extractProof: value,
  }
}

/** A collected search. The outcome defaults to encontrado and the note to null. */
export function search(
  field: Field,
  source: Source,
  outcome: SearchOutcome = 'encontrado',
  note: string | null = null,
): CollectedSearch {
  return {
    field,
    source,
    outcome,
    urls: [`https://exemplo.invalid/${source}`],
    note,
  }
}

/** A field decision. Without a new value, the source and the URL are null. */
export function decision(field: Field, choice: Decision, newValue: string | null): FieldDecision {
  return {
    field,
    decision: choice,
    newValue,
    source: newValue ? 'site' : null,
    url: newValue ? `https://exemplo.invalid/${field}` : null,
    extractProof: newValue,
    reason: `Teste: ${choice}`,
  }
}

/** One scripted answer. The fields are loose so a test can return invalid data on purpose. */
export interface AgentScript {
  evidence?: unknown
  searches?: unknown
  decisions?: unknown
  collectError?: string
}

/** Agents that replay the scripts in order. The last script repeats. */
export function fakeAgents(...scripts: AgentScript[]): Agents {
  let cursor = 0
  let current: AgentScript = {}
  const take = (): AgentScript => {
    if (scripts.length === 0) return {}
    const script = scripts[Math.min(cursor, scripts.length - 1)] ?? {}
    if (cursor < scripts.length - 1) cursor += 1
    return script
  }
  return {
    browse: {
      async collect(company, context: AgentContext) {
        current = take()
        context.log(`Recolha de teste para ${company.casualName}.`)
        if (current.collectError) throw new Error(current.collectError)
        return {
          evidence: (current.evidence ?? []) as CollectedEvidence[],
          searches: (current.searches ?? []) as CollectedSearch[],
        }
      },
    },
    compare: {
      async compare(_company, _evidence, context) {
        context.log('Comparação de teste.')
        return (current.decisions ?? []) as FieldDecision[]
      },
    },
  }
}

/** A promise with its resolve function. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
