import { useState } from 'react'

import { ArrowRight, Check, X } from 'lucide-react'
import { Link } from 'react-router'

import type { Proposal } from '../api.js'
import { useProposalActions } from '../data.js'
import { FIELD_LABELS, PROPOSAL_STATUS, formatDateTime, sourceLabel } from '../format.js'
import { FieldIcon } from './FieldIcon.js'
import { RejectDialog } from './RejectDialog.js'
import { Badge, Button, Card, cx } from './ui.js'

export function ProposalCard({ proposal, showCompany = false }: { proposal: Proposal; showCompany?: boolean }) {
  const { approve, reject } = useProposalActions()
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const pending = proposal.status === 'pendente'
  const approved = proposal.status === 'aprovada'
  const status = PROPOSAL_STATUS[proposal.status]

  async function onApprove() {
    setApproving(true)
    await approve(proposal)
    setApproving(false)
  }

  return (
    <Card className={cx('p-5', !pending && '!bg-surface/60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {showCompany && (
              <Link to={`/empresas/${proposal.entityId}`} className="font-semibold hover:text-accent">
                {proposal.entity}
              </Link>
            )}
            <Badge tone="accent">
              <FieldIcon field={proposal.field} className="size-3" />
              {FIELD_LABELS[proposal.field]}
            </Badge>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {proposal.id} · NIF {proposal.entityId} · {formatDateTime(proposal.verifiedAt)}
          </p>
        </div>
        {pending && (
          <div className="flex gap-2">
            <Button variant="danger" size="sm" icon={<X className="size-4" aria-hidden />} disabled={approving} onClick={() => setRejecting(true)}>
              Rejeitar
            </Button>
            <Button
              variant="success"
              size="sm"
              icon={<Check className="size-4" aria-hidden />}
              loading={approving}
              disabled={proposal.newValue === null}
              title={proposal.newValue === null ? 'Sem valor novo: só pode ser rejeitada' : undefined}
              onClick={() => void onApprove()}
            >
              Aprovar
            </Button>
          </div>
        )}
      </div>
      <div className="mt-4 grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <ValueBox
          label={approved ? 'Antes' : 'Atual'}
          value={proposal.currentValue ?? 'Sem valor'}
          tone="rose"
          muted
        />
        <ArrowRight className="mx-auto size-4 rotate-90 text-muted sm:rotate-0" aria-hidden />
        <ValueBox
          label={approved ? 'Depois' : 'Proposto'}
          value={proposal.newValue ?? 'Sem valor novo'}
          tone="emerald"
        />
      </div>
      <p className="mt-4 text-sm">{proposal.reason}</p>
      {proposal.extractProof && (
        <blockquote className="mt-3 border-l-2 border-accent/40 pl-3 text-sm text-muted italic">
          {`“${proposal.extractProof}”`}
        </blockquote>
      )}
      <p className="mt-3 text-xs text-muted">Fonte: {sourceLabel(proposal.source)}</p>
      {!pending && (
        <p className="mt-4 rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
          {approved
            ? `Aprovada por ${proposal.user || 'anónimo'}.`
            : `Rejeitada por ${proposal.user || 'anónimo'}: ${proposal.rejectionReason}`}
        </p>
      )}
      {pending && (
        <RejectDialog
          proposal={proposal}
          open={rejecting}
          onClose={() => setRejecting(false)}
          onConfirm={(reason) => reject(proposal, reason)}
        />
      )}
    </Card>
  )
}

function ValueBox({
  label,
  value,
  tone,
  muted = false,
}: {
  label: string
  value: string
  tone: 'rose' | 'emerald'
  muted?: boolean
}) {
  return (
    <div
      className={cx(
        'rounded-xl border px-3.5 py-2.5',
        tone === 'rose' ? 'border-rose-500/15 bg-rose-500/5' : 'border-emerald-500/20 bg-emerald-500/5',
      )}
    >
      <p
        className={cx(
          'text-[11px] font-medium tracking-wide uppercase',
          tone === 'rose' ? 'text-rose-700/80 dark:text-rose-300/80' : 'text-emerald-700/80 dark:text-emerald-300/80',
        )}
      >
        {label}
      </p>
      <p className={cx('mt-0.5 text-sm break-words', muted ? 'text-muted' : 'font-medium')}>{value}</p>
    </div>
  )
}
