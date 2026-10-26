import { ApiError } from '../errors.js'
import type { Database } from '../db/database.js'
import { findCompany, listCompanies } from '../db/companies.js'
import type { VerificationService } from './verification.js'
import type { WeeklyRound, WeeklyState, WeeklyStatus } from '../schemas/index.js'

/** Seven days, from the start of one round to the start of the next. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const DEFAULT_PAUSE_MS = 10_000
const RETRY_DELAY_MS = 15 * 60 * 1000
// The longest a timer can wait. A later round is rescheduled when the timer fires.
const MAX_TIMER_MS = 2_147_483_647
const LISBON = 'Europe/Lisbon'

/** The clock, the pause and the logger. Tests shorten the interval and the pause. */
export interface WeeklyOptions {
  now?: () => Date
  unavailableReason?: string | null
  intervalMs?: number
  pauseMs?: number
  log?: (message: string) => void
}

type Outcome =
  | { kind: 'verified'; proposals: number }
  | { kind: 'skipped' }
  | { kind: 'failed'; nif: string; casualName: string; error: string }

/**
 * The weekly verification, "verificação semanal": every company, one at a time, once a week,
 * through the same verification service as the "Verificar empresa" button.
 * It is off until someone turns it on, which starts the first round straight away.
 * Its state lives in data/runtime/schedule.json, so a restart carries on an unfinished round.
 */
export class WeeklyVerificationService {
  private readonly db: Database
  private readonly verification: VerificationService
  private readonly now: () => Date
  private readonly unavailableReason: string | null
  private readonly intervalMs: number
  private readonly pauseMs: number
  private readonly log: (message: string) => void
  private timer: ReturnType<typeof setTimeout> | undefined
  private loop: Promise<void> | undefined
  private company: { nif: string; casualName: string } | null
  private disposed: boolean

  constructor(db: Database, verification: VerificationService, options: WeeklyOptions = {}) {
    this.db = db
    this.verification = verification
    this.now = options.now ?? (() => new Date())
    this.unavailableReason = options.unavailableReason === undefined ? null : options.unavailableReason
    this.intervalMs = options.intervalMs ?? WEEK_MS
    this.pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS
    this.log = options.log ?? (() => undefined)
    this.timer = undefined
    this.loop = undefined
    this.company = null
    this.disposed = false
  }

  /** True when a round is allowed to run. */
  get available(): boolean {
    return this.unavailableReason === null
  }

  /** Resumes a stored round, closes one that was switched off, or schedules the next one. */
  async start(): Promise<void> {
    const state = await this.db.readSchedule()
    if (!state.enabled) {
      if (state.current) await this.closeRound(true)
      return
    }
    if (!this.available) return
    if (state.current) this.startRound()
    else this.schedule(state.nextRunAt)
  }

  /** The switch, the round in progress and the last finished round. */
  async status(): Promise<WeeklyStatus> {
    const running = this.loop !== undefined
    const company = this.company
    const state = await this.db.readSchedule()
    return {
      enabled: state.enabled,
      available: this.available,
      reason: this.unavailableReason,
      running,
      stopping: running && !state.enabled,
      nextRunAt: state.enabled ? state.nextRunAt : null,
      current: state.current ? { ...withoutNifs(state.current), company } : null,
      last: state.last,
    }
  }

  /** Turns the weekly verification on or off. */
  async setEnabled(enabled: boolean): Promise<WeeklyStatus> {
    if (enabled && !this.available) {
      throw new ApiError(501, 'AGENTES_INDISPONIVEIS', this.unavailableReason ?? 'Os agentes não estão ligados.')
    }
    let wasEnabled = false
    await this.changeState((current) => {
      wasEnabled = current.enabled
      if (!enabled) return { ...current, enabled: false, nextRunAt: null }
      let nextRunAt = current.nextRunAt
      // Turned back on before a stopping round ended, the round carries on, and the next one is a week after it began.
      if (nextRunAt === null && current.current) {
        nextRunAt = addWallClock(new Date(current.current.startedAt), this.intervalMs).toISOString()
      }
      return { ...current, enabled: true, nextRunAt }
    })
    if (!wasEnabled && enabled) {
      this.log('Verificação semanal ligada.')
      this.startRound()
    }
    if (wasEnabled && !enabled) {
      this.clearTimer()
      this.log(
        this.loop
          ? 'Verificação semanal desligada; a ronda para depois da empresa atual.'
          : 'Verificação semanal desligada.',
      )
    }
    return this.status()
  }

  /** Resolves once no round is running. */
  async idle(): Promise<void> {
    while (this.loop) await this.loop
  }

  /** Stops scheduling. A running round stops after its current company and resumes at the next start. */
  dispose(): void {
    this.disposed = true
    this.clearTimer()
  }

  private startRound(): void {
    if (this.loop !== undefined || this.disposed) return
    this.clearTimer()
    const run = this.executeRound().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`A verificação semanal falhou: ${message} Volta a tentar daqui a 15 minutos.`)
      this.arm(RETRY_DELAY_MS)
    })
    this.loop = run.finally(() => {
      this.loop = undefined
      this.company = null
    })
  }

  private async executeRound(): Promise<void> {
    const companies = await listCompanies(this.db)
    companies.sort((left, right) => left.casualName.localeCompare(right.casualName, 'pt'))
    let resuming = false
    const opened = await this.changeState((current) => {
      if (current.current) {
        resuming = true
        return current
      }
      const startedAt = this.now().toISOString()
      return {
        ...current,
        nextRunAt: addWallClock(new Date(startedAt), this.intervalMs).toISOString(),
        current: {
          startedAt,
          finishedAt: null,
          total: companies.length,
          done: 0,
          verified: 0,
          skipped: 0,
          failures: [],
          proposals: 0,
          interrupted: false,
          nifs: companies.map((company) => company.nif),
        },
      }
    })
    const round = opened.current
    if (!round) return
    this.log(
      resuming
        ? `Verificação semanal: a retomar a ronda (${round.done} de ${round.total}).`
        : `Verificação semanal: ronda de ${round.total} empresas iniciada.`,
    )
    while (true) {
      if (this.disposed) return
      const state = await this.db.readSchedule()
      if (!state.enabled || !state.current) break
      if (state.current.done >= state.current.nifs.length) break
      const nif = state.current.nifs[state.current.done]
      if (nif === undefined) break
      const outcome = await this.verifyOne(nif)
      await this.changeState((current) => {
        if (!current.current) return current
        const failures =
          outcome.kind === 'failed'
            ? [
                ...current.current.failures,
                { nif: outcome.nif, casualName: outcome.casualName, error: outcome.error },
              ]
            : current.current.failures
        return {
          ...current,
          current: {
            ...current.current,
            done: current.current.done + 1,
            verified: current.current.verified + (outcome.kind === 'verified' ? 1 : 0),
            skipped: current.current.skipped + (outcome.kind === 'skipped' ? 1 : 0),
            proposals: current.current.proposals + (outcome.kind === 'verified' ? outcome.proposals : 0),
            failures,
          },
        }
      })
      const after = await this.db.readSchedule()
      const remaining = after.current !== null && after.current.done < after.current.nifs.length
      if (remaining && after.enabled && this.pauseMs > 0) await this.pause()
    }
    // The saved round carries on at the next start.
    if (this.disposed) return
    await this.closeRound(false)
  }

  private async verifyOne(nif: string): Promise<Outcome> {
    const company = await findCompany(this.db, nif)
    if (!company) return { kind: 'skipped' }
    this.company = { nif: company.nif, casualName: company.casualName }
    try {
      const result = await this.verification.verify(nif)
      this.log(`Verificação semanal: ${company.casualName} verificada (${result.proposals.length} propostas novas).`)
      return { kind: 'verified', proposals: result.proposals.length }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        // A company already being verified, or one with proposals still to review, is left to that review.
        this.log(`Verificação semanal: ${company.casualName} saltada: ${error.message}`)
        return { kind: 'skipped' }
      }
      const message = error instanceof Error ? error.message : String(error)
      this.log(`Verificação semanal: ${message}`)
      return { kind: 'failed', nif: company.nif, casualName: company.casualName, error: message }
    } finally {
      this.company = null
    }
  }

  private async closeRound(forceInterrupted: boolean): Promise<void> {
    const finishedAt = this.now().toISOString()
    let closed = false
    const state = await this.changeState((current) => {
      if (!current.current) return current
      closed = true
      const round = withoutNifs(current.current)
      return {
        ...current,
        current: null,
        last: {
          ...round,
          finishedAt,
          interrupted: forceInterrupted || round.done < round.total,
        },
      }
    })
    if (!closed || !state.last) return
    const word = state.last.interrupted ? 'interrompida' : 'terminada'
    this.log(
      `Verificação semanal: ronda ${word}: ${state.last.verified} verificadas, ${state.last.failures.length} falharam, ${state.last.skipped} saltadas, ${state.last.proposals} propostas novas.`,
    )
    if (state.enabled) this.schedule(state.nextRunAt)
  }

  private schedule(nextRunAt: string | null): void {
    if (nextRunAt === null) {
      this.arm(0)
      return
    }
    this.arm(new Date(nextRunAt).getTime() - this.now().getTime())
  }

  private arm(delay: number): void {
    this.clearTimer()
    if (this.disposed) return
    const clamped = Math.min(Math.max(delay, 0), MAX_TIMER_MS)
    const timer = setTimeout(() => {
      void this.onFire()
    }, clamped)
    // A scheduled round alone doesn't keep the process running.
    timer.unref()
    this.timer = timer
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async onFire(): Promise<void> {
    try {
      const state = await this.db.readSchedule()
      if (!state.enabled || !this.available || this.loop !== undefined) return
      const due = state.nextRunAt === null || new Date(state.nextRunAt).getTime() <= this.now().getTime()
      if (state.current !== null || due) this.startRound()
      else this.schedule(state.nextRunAt)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`A verificação semanal falhou: ${message}`)
    }
  }

  private pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.pauseMs))
  }

  private changeState(change: (state: WeeklyState) => WeeklyState): Promise<WeeklyState> {
    return this.db.withLock(async () => {
      const state = await this.db.readSchedule()
      const next = change(state)
      await this.db.writeSchedule(next)
      return next
    })
  }
}

function withoutNifs(round: WeeklyRound & { nifs: string[] }): WeeklyRound {
  const { nifs: _nifs, ...rest } = round
  return rest
}

// A round started at 10:40 Lisbon time on 21 October has its next round at 10:40 Lisbon time
// on 28 October, although the clocks change on 25 October.
function addWallClock(start: Date, intervalMs: number): Date {
  const naive = new Date(start.getTime() + intervalMs)
  return new Date(naive.getTime() + (zoneOffset(start) - zoneOffset(naive)))
}

function zoneOffset(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LISBON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  return asUtc - date.getTime()
}
