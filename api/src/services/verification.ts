import { prettifyError, z } from 'zod'

import type { Agents, AgentContext } from '../agents/types.js'
import { sameValue } from '../agents/compare/normalize.js'
import { FIELD_TITLES } from '../agents/sources.js'
import type { Database } from '../db/database.js'
import { replaceEvidence, replaceSearches } from '../db/evidence.js'
import { insertProposals, type NewProposal } from '../db/proposals.js'
import { findCompany } from '../db/companies.js'
import { ApiError, companyNotFound } from '../errors.js'
import {
  CollectedEvidenceSchema,
  CollectedSearchSchema,
  FieldDecisionSchema,
  type Company,
  type Evidence,
  type Field,
  type FieldDecision,
  type Proposal,
  type RecordedDecision,
  type Search,
  type Step,
  type StepAgent,
  type VerificationResult,
} from '../schemas/index.js'

const collectionResultSchema = z.object({
  evidence: z.array(CollectedEvidenceSchema),
  searches: z.array(CollectedSearchSchema),
})

const decisionListSchema = z.array(FieldDecisionSchema).superRefine((decisions, ctx) => {
  const seen = new Set<string>()
  for (const [index, decision] of decisions.entries()) {
    if (seen.has(decision.field)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'field'],
        message: `Há mais de uma decisão para ${decision.field}.`,
      })
    }
    seen.add(decision.field)
  }
})

/** Called with each step as it happens, for the live view. */
export interface VerifyOptions {
  onStep?: (step: Step) => void
}

/** A change the user rejected isn't proposed again until this long after it was proposed. */
export const REJECTED_QUIET_MS = 14 * 24 * 60 * 60 * 1000

const DEFAULT_TIMEOUT_MS = 1_200_000
const DEFAULT_UNAVAILABLE = 'Os agentes de recolha e de comparação não estão ligados a esta API.'

interface HeldBack {
  field: Field
  id: string
  date: string
}

/** Runs one company's collection and comparison and turns the result into proposals. */
export class VerificationService {
  private readonly db: Database
  private readonly agents: Agents | undefined
  private readonly now: () => Date
  private readonly unavailableReason: string
  private readonly timeoutMs: number
  private readonly running = new Set<string>()

  constructor(
    db: Database,
    agents: Agents | undefined,
    now: () => Date,
    options: { unavailableReason?: string | null; timeoutMs?: number } = {},
  ) {
    this.db = db
    this.agents = agents
    this.now = now
    this.unavailableReason = options.unavailableReason ?? DEFAULT_UNAVAILABLE
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** The checks before a run: the company exists, the agents are on, it is not already running, and nothing is waiting for review. */
  async check(nif: string): Promise<{ company: Company; agents: Agents }> {
    const company = await findCompany(this.db, nif)
    if (!company) throw companyNotFound(nif)
    if (!this.agents) throw new ApiError(501, 'AGENTES_INDISPONIVEIS', this.unavailableReason)
    if (this.running.has(nif)) {
      throw new ApiError(409, 'VERIFICACAO_EM_CURSO', `Já está a decorrer uma verificação de ${company.casualName}.`)
    }
    const proposals = await this.db.readProposals()
    const waiting = proposals.some((proposal) => proposal.entityId === company.nif && proposal.status === 'pendente')
    if (waiting) {
      throw new ApiError(
        409,
        'PROPOSTAS_PENDENTES',
        `${company.casualName} tem propostas por aprovar. Os agentes não atuam sobre esta empresa enquanto elas não forem revistas.`,
      )
    }
    return { company, agents: this.agents }
  }

  /** Verifies one company. A second request for the same NIF is refused until this one finishes. */
  async verify(nif: string, options: VerifyOptions = {}): Promise<VerificationResult> {
    const ready = await this.check(nif)
    if (this.running.has(nif)) {
      throw new ApiError(
        409,
        'VERIFICACAO_EM_CURSO',
        `Já está a decorrer uma verificação de ${ready.company.casualName}.`,
      )
    }
    this.running.add(nif)
    try {
      return await this.run(ready.company, ready.agents, options)
    } finally {
      this.running.delete(nif)
    }
  }

  private async run(company: Company, agents: Agents, options: VerifyOptions): Promise<VerificationResult> {
    const steps: Step[] = []
    const push = (agent: StepAgent, message: string): void => {
      const step: Step = { at: this.now().toISOString(), agent, message }
      steps.push(step)
      options.onStep?.(step)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      push('sistema', `Verificação de ${company.casualName} iniciada.`)
      const collected = await this.collect(company, agents, controller.signal, push)
      const decisions = await this.compare(company, collected.evidence, agents, controller.signal, push)
      return await this.db.withLock(async () => {
        await replaceEvidence(this.db, company.nif, collected.evidence)
        await replaceSearches(this.db, company.nif, collected.searches)
        const recorded = await this.record(company, decisions)
        for (const held of recorded.heldBack) {
          push(
            'sistema',
            `${FIELD_TITLES[held.field]}: esta alteração foi rejeitada (${held.id}); só volta a ser proposta a partir de ${held.date}.`,
          )
        }
        const created = recorded.proposals.length
        push('sistema', created === 1 ? '1 proposta nova criada.' : `${created} propostas novas criadas.`)
        return {
          decisions: recorded.decisions,
          steps,
          evidence: collected.evidence,
          searches: collected.searches,
          proposals: recorded.proposals,
        }
      })
    } catch (error) {
      if (error instanceof ApiError) throw error
      const message = controller.signal.aborted
        ? `demorou mais de ${Math.round(this.timeoutMs / 60_000)} minutos e foi interrompida`
        : error instanceof Error
          ? error.message
          : String(error)
      push('sistema', `A verificação falhou: ${message}`)
      throw new ApiError(500, 'VERIFICACAO_FALHOU', `A verificação de ${company.casualName} falhou: ${message}`, {
        steps,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  private async collect(
    company: Company,
    agents: Agents,
    signal: AbortSignal,
    push: (agent: StepAgent, message: string) => void,
  ): Promise<{ evidence: Evidence[]; searches: Search[] }> {
    const context: AgentContext = {
      log: (message) => push('recolha', message),
      signal,
    }
    const raw = await agents.browse.collect(company, context)
    const parsed = collectionResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`O agente de recolha devolveu dados inválidos: ${prettifyError(parsed.error)}`)
    }
    const evidence: Evidence[] = parsed.data.evidence.map((item) => ({
      nif: company.nif,
      field: item.field,
      value: item.value,
      source: item.source,
      url: item.url,
      extractProof: item.extractProof,
      foundAt: item.foundAt ?? this.now().toISOString(),
    }))
    const searchedAt = this.now().toISOString()
    const searches: Search[] = parsed.data.searches.map((item) => ({
      nif: company.nif,
      field: item.field,
      source: item.source,
      outcome: item.outcome,
      urls: item.urls,
      note: item.note,
      searchedAt,
    }))
    const found = evidence.length
    push('sistema', found === 1 ? '1 evidência recolhida.' : `${found} evidências recolhidas.`)
    return { evidence, searches }
  }

  private async compare(
    company: Company,
    evidence: Evidence[],
    agents: Agents,
    signal: AbortSignal,
    push: (agent: StepAgent, message: string) => void,
  ): Promise<FieldDecision[]> {
    const context: AgentContext = {
      log: (message) => push('comparacao', message),
      signal,
    }
    const raw = await agents.compare.compare(company, evidence, context)
    const parsed = decisionListSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`O agente de comparação devolveu dados inválidos: ${prettifyError(parsed.error)}`)
    }
    return parsed.data
  }

  private async record(
    company: Company,
    decisions: FieldDecision[],
  ): Promise<{ decisions: RecordedDecision[]; proposals: Proposal[]; heldBack: HeldBack[] }> {
    // Proposals have no review timestamp (there is no reviewedAt).
    const now = this.now()
    const verifiedAt = now.toISOString()
    const existing = (await this.db.readProposals()).filter((proposal) => proposal.entityId === company.nif)
    const pending = existing.filter((proposal) => proposal.status === 'pendente')
    const recent = existing.filter(
      (proposal) =>
        proposal.status === 'rejeitada' &&
        now.getTime() - new Date(proposal.verifiedAt).getTime() < REJECTED_QUIET_MS,
    )
    const recorded: RecordedDecision[] = decisions.map((decision) => ({
      field: decision.field,
      decision: decision.decision,
      newValue: decision.newValue,
      source: decision.source,
      url: decision.url,
      extractProof: decision.extractProof,
      reason: decision.reason,
      currentValue: company[decision.field],
      proposalId: null,
    }))
    const prepared: NewProposal[] = []
    const preparedIndexes: number[] = []
    const heldBack: HeldBack[] = []
    for (const [index, decision] of recorded.entries()) {
      if (decision.decision !== 'propor' && decision.decision !== 'rever') continue
      const identical = pending.find(
        (proposal) => proposal.field === decision.field && proposal.newValue === decision.newValue,
      )
      if (identical) {
        decision.proposalId = identical.id
        continue
      }
      const rejected = recent.find((proposal) => sameChange(decision.field, proposal.newValue, decision.newValue))
      if (rejected) {
        const date = portugueseDate(new Date(new Date(rejected.verifiedAt).getTime() + REJECTED_QUIET_MS))
        const suffix = rejected.rejectionReason.length > 0 ? `: ${rejected.rejectionReason}` : ''
        decision.decision = 'manter'
        decision.newValue = null
        decision.reason = `A mesma alteração foi rejeitada (${rejected.id}${suffix}). Só volta a ser proposta a partir de ${date}.`
        heldBack.push({ field: decision.field, id: rejected.id, date })
        continue
      }
      prepared.push({
        entity: company.casualName,
        entityId: company.nif,
        field: decision.field,
        currentValue: company[decision.field],
        newValue: decision.newValue,
        source: decision.source,
        extractProof: decision.extractProof,
        verifiedAt,
        reason: decision.reason,
        status: 'pendente',
        rejectionReason: '',
        user: '',
      })
      preparedIndexes.push(index)
    }
    const proposals = await insertProposals(this.db, prepared)
    for (const [index, proposal] of proposals.entries()) {
      const recordedIndex = preparedIndexes[index]
      const target = recordedIndex === undefined ? undefined : recorded[recordedIndex]
      if (target) target.proposalId = proposal.id
    }
    return { decisions: recorded, proposals, heldBack }
  }
}

function sameChange(field: Field, left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right
  return left === right || sameValue(field, left, right)
}

function portugueseDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('day')}/${part('month')}/${part('year')}`
}
