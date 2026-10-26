import { useRef, useState } from 'react'

import { ArrowLeft, Building, ExternalLink, Inbox, Scan } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'

import { api, toApiError, type Step, type VerificationResult } from '../api.js'
import { useApi, useAppState } from '../data.js'
import {
  FIELD_LABELS,
  FIELD_ORDER,
  companyStatusTone,
  displayUrl,
  missingTools,
  plural,
  siteHref,
} from '../format.js'
import { EvidenceList } from '../components/EvidenceList.js'
import { FieldIcon } from '../components/FieldIcon.js'
import { ProposalCard } from '../components/ProposalCard.js'
import { LiveVerification, VerificationPanel } from '../components/VerificationPanel.js'
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, SectionTitle, Skeleton } from '../components/ui.js'

export function CompanyPage() {
  const { nif = '' } = useParams()
  const detail = useApi(() => api.getCompany(nif), [nif])
  const agents = useApi(() => api.getAgents())
  const { refresh } = useAppState()
  const [verifying, setVerifying] = useState(false)
  const [live, setLive] = useState<{ steps: Step[]; failed: boolean } | null>(null)
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const panelOpen = useRef(false)

  const agentsOff = agents.data !== undefined && !agents.data.enabled
  const offReason = unavailable ?? (agentsOff ? agents.data?.reason : null)

  async function verify() {
    setVerifying(true)
    setResult(null)
    setLive({ steps: [], failed: false })
    panelOpen.current = true
    try {
      const outcome = await api.verifyCompanyStream(nif, (step) => {
        if (!panelOpen.current) return
        setLive((current) => (current ? { ...current, steps: [...current.steps, step] } : current))
      })
      panelOpen.current = false
      setLive(null)
      setResult(outcome)
      setUnavailable(null)
      toast.success('Verificação concluída', {
        description: plural(outcome.proposals.length, 'proposta nova', 'propostas novas'),
      })
      refresh()
    } catch (caught) {
      const error = toApiError(caught)
      if (error.status === 501) {
        panelOpen.current = false
        setLive(null)
        setUnavailable(error.message)
      } else {
        // Steps already shown stay on screen, so it's clear where it stopped.
        setLive((current) => {
          if (current && current.steps.length > 0) return { ...current, failed: true }
          panelOpen.current = false
          return null
        })
        toast.error('A verificação falhou', { description: error.message })
      }
    } finally {
      setVerifying(false)
    }
  }

  if (detail.error?.status === 404) {
    return (
      <Card>
        <title>Empresa não encontrada · Data Integrity Agent</title>
        <EmptyState
          icon={<Building />}
          title="Empresa não encontrada"
          description={detail.error.message}
          action={
            <Link to="/" className="text-sm font-medium text-accent hover:underline">
              Voltar às empresas
            </Link>
          }
        />
      </Card>
    )
  }
  if (detail.error && !detail.data) {
    return (
      <Card>
        <ErrorState error={detail.error} onRetry={detail.retry} />
      </Card>
    )
  }
  if (!detail.data) {
    return <CompanySkeleton />
  }

  const { company, evidence, searches, proposals } = detail.data
  const pendingFields = new Set(proposals.filter((proposal) => proposal.status === 'pendente').map((proposal) => proposal.field))
  // The evidence only shows the fields with a proposed change.
  const proposedFields = [...new Set(proposals.map((proposal) => proposal.field))]
  const shownEvidence = evidence.filter((item) => proposedFields.includes(item.field))

  return (
    <>
      <title>{`${company.casualName} · Data Integrity Agent`}</title>
      <Link to="/" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Empresas
      </Link>
      <PageHeader
        title={company.casualName}
        description={company.name}
        actions={
          <Button
            variant="primary"
            icon={<Scan className="size-4" aria-hidden />}
            loading={verifying}
            disabled={agentsOff}
            onClick={() => void verify()}
          >
            {verifying ? 'A verificar…' : 'Verificar empresa'}
          </Button>
        }
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>NIF {company.nif}</Badge>
          <Badge tone={companyStatusTone(company.status)} dot>
            {company.status}
          </Badge>
          {pendingFields.size > 0 && (
            <Badge tone="warning">{plural(pendingFields.size, 'campo por rever', 'campos por rever')}</Badge>
          )}
        </div>
      </PageHeader>
      {offReason && <Notice title="Os agentes estão desligados">{offReason}</Notice>}
      {live && (
        <LiveVerification
          steps={live.steps}
          failed={live.failed}
          tools={missingTools(agents.data)}
          onDismiss={() => {
            panelOpen.current = false
            setLive(null)
          }}
        />
      )}
      {result && <VerificationPanel result={result} onDismiss={() => setResult(null)} />}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="min-w-0">
          <SectionTitle title="Dados guardados" />
          <Card className="p-5">
            <dl className="divide-y divide-line">
              {FIELD_ORDER.map((field, index) => {
                const value = company[field]
                return (
                  <div
                    key={field}
                    className={`flex gap-3 py-3.5 ${index === 0 ? 'pt-0' : ''} ${index === FIELD_ORDER.length - 1 ? 'pb-0' : ''}`}
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted">
                      <FieldIcon field={field} />
                    </div>
                    <div className="min-w-0">
                      <dt className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
                        {FIELD_LABELS[field]}
                        {pendingFields.has(field) && <Badge tone="warning">Proposta pendente</Badge>}
                      </dt>
                      <dd className="mt-0.5 text-sm break-words">
                        <FieldValue field={field} value={value} />
                      </dd>
                    </div>
                  </div>
                )
              })}
            </dl>
          </Card>
        </section>
        <div className="min-w-0 space-y-8 lg:col-span-2">
          <section>
            <SectionTitle title="Propostas" count={proposals.length} />
            {proposals.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Inbox />}
                  title="Sem propostas"
                  description="As propostas desta empresa aparecem aqui depois de uma verificação."
                />
              </Card>
            ) : (
              <div className="space-y-4">
                {proposals.map((proposal) => (
                  <ProposalCard key={proposal.id} proposal={proposal} />
                ))}
              </div>
            )}
          </section>
          <section>
            <SectionTitle title="Evidência da última verificação" count={shownEvidence.length} />
            <Card>
              <EvidenceList evidence={evidence} searches={searches} fields={proposedFields} />
            </Card>
          </section>
        </div>
      </div>
    </>
  )
}

function FieldValue({ field, value }: { field: (typeof FIELD_ORDER)[number]; value: string | null }) {
  if (!value) return <span className="text-muted">Sem valor</span>
  if (field === 'site') {
    return (
      <a
        href={siteHref(value)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1 font-medium text-accent hover:underline"
      >
        <span className="truncate">{displayUrl(value)}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden />
      </a>
    )
  }
  if (field === 'cae') return <span className="font-mono">{value}</span>
  return value
}

function CompanySkeleton() {
  return (
    <div aria-busy="true" aria-label="A carregar a empresa">
      <Skeleton className="mb-6 h-4 w-24" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-80" />
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-2xl" />
        <div className="space-y-4 lg:col-span-2">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
