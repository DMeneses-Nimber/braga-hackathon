import { useEffect, useState, type ReactNode } from 'react'

import { LoaderCircle, Sparkles, TriangleAlert, X } from 'lucide-react'

import type { RecordedDecision, Step, VerificationResult } from '../api.js'
import { DECISIONS, FIELD_LABELS, STEP_AGENTS, formatTime, plural } from '../format.js'
import { FieldIcon } from './FieldIcon.js'
import { Badge, Card } from './ui.js'

export function VerificationPanel({ result, onDismiss }: { result: VerificationResult; onDismiss: () => void }) {
  return (
    <Card className="mb-6 overflow-hidden">
      <PanelHeader
        icon={<Sparkles className="size-4" aria-hidden />}
        title="Resultado da verificação"
        subtitle={`${plural(result.proposals.length, 'proposta nova', 'propostas novas')} · ${plural(result.evidence.length, 'evidência', 'evidências')}`}
        onDismiss={onDismiss}
      />
      <div className="md:grid md:grid-cols-2 md:divide-x md:divide-line">
        <section className="p-5">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Decisões por campo</h3>
          <div className="mt-3 space-y-2.5">
            {result.decisions.map((decision) => (
              <DecisionBox key={decision.field} decision={decision} />
            ))}
          </div>
        </section>
        <section className="p-5">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Passos</h3>
          <div className="mt-3">
            <StepList steps={result.steps} live={false} />
          </div>
        </section>
      </div>
    </Card>
  )
}

export function LiveVerification({
  steps,
  failed,
  tools,
  onDismiss,
}: {
  steps: Step[]
  failed: boolean
  tools?: string
  onDismiss: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (failed) return
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [failed])
  const subtitle = `${plural(steps.length, 'passo', 'passos')} · ${seconds} s${tools ? ` · ${tools}` : ''}`
  return (
    <Card className="mb-6 overflow-hidden">
      <PanelHeader
        icon={
          failed ? (
            <TriangleAlert className="size-4 text-rose-600 dark:text-rose-300" aria-hidden />
          ) : (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          )
        }
        title={failed ? 'A verificação falhou' : 'Os agentes estão a verificar…'}
        subtitle={subtitle}
        onDismiss={failed ? onDismiss : undefined}
      />
      <div className="p-5">
        {steps.length === 0 ? (
          <p className="text-sm text-muted">A iniciar…</p>
        ) : (
          <StepList steps={steps} live={!failed} />
        )}
      </div>
    </Card>
  )
}

function PanelHeader({
  icon,
  title,
  subtitle,
  onDismiss,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  onDismiss?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</div>
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Fechar"
          onClick={onDismiss}
          className="rounded-md p-1 text-muted hover:bg-subtle hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

function StepList({ steps, live }: { steps: Step[]; live: boolean }) {
  return (
    <ol aria-live={live ? 'polite' : undefined} className="space-y-3 border-l border-line pl-4">
      {steps.map((step, index) => {
        const last = live && index === steps.length - 1
        const agent = STEP_AGENTS[step.agent]
        return (
          <li key={`${step.at}-${index}`} className="relative">
            <span
              className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-surface ${agent.dot} ${last ? 'animate-pulse' : ''}`}
            />
            <p className={`text-sm break-words ${last ? 'font-medium' : ''}`}>{step.message}</p>
            <p className="text-xs text-muted">
              {agent.label} · {formatTime(step.at)}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

function DecisionBox({ decision }: { decision: RecordedDecision }) {
  const meta = DECISIONS[decision.decision]
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <FieldIcon field={decision.field} className="text-muted" />
          {FIELD_LABELS[decision.field]}
        </span>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      {decision.newValue && (
        <p className="mt-1.5 text-sm break-words">
          <span className="text-muted">{decision.currentValue ?? 'Sem valor'}</span>
          {' → '}
          <span className="font-medium">{decision.newValue}</span>
        </p>
      )}
      <p className="mt-1 text-xs text-muted">{decision.reason}</p>
    </div>
  )
}
