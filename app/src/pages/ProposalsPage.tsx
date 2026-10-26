import { CircleCheck, Inbox } from 'lucide-react'
import { useSearchParams } from 'react-router'

import type { ProposalFilter } from '../api.js'
import { api } from '../api.js'
import { useApi } from '../data.js'
import { ReviewerField } from '../components/Layout.js'
import { ProposalCard } from '../components/ProposalCard.js'
import { Card, EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from '../components/ui.js'

const FILTERS: { value: ProposalFilter; label: string; empty: string }[] = [
  { value: 'pendente', label: 'Pendentes', empty: 'Não há propostas à espera de revisão.' },
  { value: 'aprovada', label: 'Aprovadas', empty: 'Ainda nenhuma proposta foi aprovada.' },
  { value: 'rejeitada', label: 'Rejeitadas', empty: 'Ainda nenhuma proposta foi rejeitada.' },
  { value: 'todas', label: 'Todas', empty: 'Ainda não há propostas.' },
]

export function ProposalsPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('estado')
  const filter = FILTERS.some((item) => item.value === requested) ? (requested as ProposalFilter) : 'pendente'
  const proposals = useApi(() => api.listProposals('todas'))
  const current = FILTERS.find((item) => item.value === filter) ?? FILTERS[0]
  const visible = (proposals.data ?? []).filter((proposal) => filter === 'todas' || proposal.status === filter)

  return (
    <>
      <title>Propostas · Data Integrity Agent</title>
      <PageHeader
        title="Propostas"
        description="Cada proposta muda um campo de uma empresa. Só a aprovação altera os dados guardados; quem aprova ou rejeita fica registado."
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Estado das propostas"
          value={filter}
          onChange={(value) => {
            if (value === 'pendente') setParams({})
            else setParams({ estado: value })
          }}
          options={FILTERS.map((item) => ({
            value: item.value,
            label: (
              <>
                {item.label}
                {proposals.data && (
                  <span className="ml-1.5 text-xs text-muted tabular-nums">
                    {item.value === 'todas'
                      ? proposals.data.length
                      : proposals.data.filter((proposal) => proposal.status === item.value).length}
                  </span>
                )}
              </>
            ),
          }))}
        />
        <ReviewerField className="md:hidden" />
      </div>
      {proposals.error && !proposals.data ? (
        <Card>
          <ErrorState error={proposals.error} onRetry={proposals.retry} />
        </Card>
      ) : proposals.loading && !proposals.data ? (
        <div className="space-y-4">
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-52 rounded-2xl" />
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={filter === 'pendente' ? <CircleCheck /> : <Inbox />}
            title={filter === 'pendente' ? 'Nada por rever' : `Sem propostas ${current?.label.toLowerCase() ?? ''}`}
            description={current?.empty}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {visible.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} showCompany />
          ))}
        </div>
      )}
    </>
  )
}
