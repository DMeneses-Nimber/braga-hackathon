import { useEffect, useRef, useState } from 'react'

import { CalendarClock } from 'lucide-react'
import { toast } from 'sonner'

import { api, toApiError, type WeeklyStatus } from '../api.js'
import { useAppState } from '../data.js'
import { formatDateTime, plural } from '../format.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { Card, Switch } from './ui.js'

export function WeeklyCheck() {
  const { refresh } = useAppState()
  const [status, setStatus] = useState<WeeklyStatus>()
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const seen = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const running = { current: false }
    async function load() {
      try {
        const next = await api.getWeekly()
        if (cancelled) return
        running.current = next.running
        setStatus(next)
      } catch {
        // The company list already says when the API can't be reached.
      }
    }
    async function tick() {
      await load()
      if (cancelled) return
      timer = window.setTimeout(() => void tick(), running.current ? 3000 : 30000)
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const progressKey = status?.current
    ? `${status.current.startedAt}:${status.current.done}`
    : (status?.last?.finishedAt ?? '')

  const loadedKey = status ? progressKey : null

  useEffect(() => {
    if (loadedKey === null) return
    if (!seen.current) {
      seen.current = true
      return
    }
    refresh()
  }, [loadedKey, refresh])

  async function save(enabled: boolean) {
    setSaving(true)
    try {
      const next = await api.setWeekly(enabled)
      setStatus(next)
      setConfirming(false)
      if (enabled) {
        toast.success('Verificação semanal ligada', { description: 'A primeira ronda já começou.' })
      } else {
        toast.success('Verificação semanal desligada', {
          description: next.running
            ? 'A ronda em curso para depois da empresa que está a ser verificada.'
            : undefined,
        })
      }
    } catch (caught) {
      toast.error(
        enabled ? 'Não foi possível ligar a verificação semanal' : 'Não foi possível desligar a verificação semanal',
        { description: toApiError(caught).message },
      )
    } finally {
      setSaving(false)
    }
  }

  // With the agents off it can't be turned on, but it can always be turned off.
  const blocked = status !== undefined && !status.available && !status.enabled

  return (
    <Card className="mt-6 p-5">
      <div className="flex items-start gap-4">
        <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent sm:flex">
          <CalendarClock className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Verificação semanal</h2>
              <p className="mt-0.5 text-sm text-muted">
                Uma vez por semana, verifica os campos de todas as empresas, uma de cada vez.
              </p>
            </div>
            <Switch
              label="Verificação semanal"
              checked={status?.enabled ?? false}
              disabled={!status || saving || blocked}
              onChange={(enabled) => {
                if (enabled) setConfirming(true)
                else void save(false)
              }}
            />
          </div>
          {status && (
            <div className="mt-4 space-y-2 text-sm">
              {!status.available && status.reason && (
                <p className="text-amber-700 dark:text-amber-300">{status.reason}</p>
              )}
              {status.current && status.running && <Progress current={status.current} stopping={status.stopping} />}
              {status.current && !status.running && (
                <p className="text-muted">
                  Ronda parada a meio: {status.current.done} de {status.current.total} empresas. Continua quando os
                  agentes estiverem ligados.
                </p>
              )}
              {status.enabled && status.nextRunAt && (
                <p className="text-muted">Próxima ronda: {formatDateTime(status.nextRunAt)}.</p>
              )}
              {!status.enabled && !status.running && <p className="text-muted">Desligada.</p>}
              {status.last && <LastRound last={status.last} />}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Ligar a verificação semanal?"
        confirmLabel="Ligar"
        busy={saving}
        onClose={() => setConfirming(false)}
        onConfirm={() => void save(true)}
      >
        <p>
          Vai começar uma tarefa em segundo plano que verifica os campos de cada empresa, uma de cada vez, e se repete
          todas as semanas.
        </p>
        <p>
          Cada verificação usa os agentes de IA, por isso vai consumir recursos: tokens do Grok e pedidos às fontes. A
          primeira ronda começa já, e pode desligá-la a qualquer momento.
        </p>
      </ConfirmDialog>
    </Card>
  )
}

function tally(round: { verified: number; proposals: number; failures: unknown[]; skipped: number }): string {
  const parts = [
    plural(round.verified, 'verificada', 'verificadas'),
    plural(round.proposals, 'proposta nova', 'propostas novas'),
  ]
  if (round.failures.length > 0) parts.push(plural(round.failures.length, 'falhou', 'falharam'))
  if (round.skipped > 0) parts.push(plural(round.skipped, 'saltada', 'saltadas'))
  return parts.join(' · ')
}

function Progress({
  current,
  stopping,
}: {
  current: NonNullable<WeeklyStatus['current']>
  stopping: boolean
}) {
  const percent = current.total === 0 ? 0 : Math.round((current.done / current.total) * 100)
  const position = Math.min(current.done + 1, current.total)
  const company = current.company?.casualName
  const title = stopping
    ? `A parar depois de ${company ?? 'a empresa atual'}…`
    : company
      ? `A verificar ${company} (${position} de ${current.total})`
      : `A verificar: ${current.done} de ${current.total} feitas`
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate font-medium">{title}</p>
        <p className="text-xs text-muted tabular-nums">{percent}%</p>
      </div>
      <div
        role="progressbar"
        aria-label="Progresso da ronda"
        aria-valuemin={0}
        aria-valuemax={current.total}
        aria-valuenow={current.done}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted">{tally(current)}</p>
    </div>
  )
}

function LastRound({ last }: { last: NonNullable<WeeklyStatus['last']> }) {
  const when = formatDateTime(last.finishedAt ?? last.startedAt)
  const names = last.failures.map((failure) => failure.casualName).join(', ')
  return (
    <p className="text-muted">
      Última ronda{last.interrupted ? ', interrompida' : ''}, {when}: {tally(last)}
      {names ? ` (${names})` : ''}.
    </p>
  )
}
