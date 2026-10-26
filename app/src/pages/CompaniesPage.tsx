import { useMemo, useState } from 'react'

import { Building, ChevronRight, ClipboardCheck, ListChecks, Search } from 'lucide-react'
import { Link, useNavigate } from 'react-router'

import { api } from '../api.js'
import { useApi } from '../data.js'
import { companyStatusTone, normalize } from '../format.js'
import { WeeklyCheck } from '../components/WeeklyCheck.js'
import { Badge, Card, EmptyState, ErrorState, PageHeader, Segmented, Skeleton, Stat } from '../components/ui.js'

const EMPTY = '–'

export function CompaniesPage() {
  const companies = useApi(() => api.listCompanies())
  const [query, setQuery] = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)
  const navigate = useNavigate()
  const list = companies.data

  const filtered = useMemo(() => {
    const needle = normalize(query.trim())
    return (list ?? []).filter((company) => {
      const haystack = normalize([company.casualName, company.name, company.nif, company.address ?? ''].join(' '))
      if (needle && !haystack.includes(needle)) return false
      if (pendingOnly && company.pendingProposals < 1) return false
      return true
    })
  }, [list, query, pendingOnly])

  const pending = list?.reduce((sum, company) => sum + company.pendingProposals, 0) ?? 0
  const toReview = list?.filter((company) => company.pendingProposals > 0).length ?? 0

  return (
    <>
      <title>Empresas · Data Integrity Agent</title>
      <PageHeader
        title="Empresas"
        description="Os dados guardados de cada empresa. Abra uma empresa para ver a evidência e rever as propostas."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat icon={<Building />} label="Empresas" value={list ? list.length : EMPTY} />
        <Stat icon={<ClipboardCheck />} label="Propostas pendentes" value={list ? pending : EMPTY} highlight />
        <Stat icon={<ListChecks />} label="Empresas por rever" value={list ? toReview : EMPTY} />
      </div>
      <WeeklyCheck />
      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              aria-label="Procurar empresas"
              placeholder="Procurar por nome, NIF ou morada"
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-lg border border-line bg-canvas pr-3 pl-9 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <Segmented
            label="Filtrar empresas"
            value={pendingOnly ? 'pending' : 'all'}
            onChange={(value) => setPendingOnly(value === 'pending')}
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'pending', label: 'Com propostas' },
            ]}
          />
        </div>
        {companies.error && !list ? (
          <ErrorState error={companies.error} onRetry={companies.retry} />
        ) : companies.loading && !list ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="Nenhuma empresa encontrada"
            description={
              pendingOnly
                ? 'Nenhuma empresa tem propostas à espera de revisão.'
                : 'Experimente outro nome, NIF ou morada.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium tracking-wide text-muted uppercase">
                  <th className="px-4 py-3">Empresa</th>
                  <th className="hidden px-4 py-3 sm:table-cell">NIF</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Morada</th>
                  <th className="hidden px-4 py-3 md:table-cell">CAE</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Estado</th>
                  <th className="px-4 py-3 text-right">Propostas</th>
                  <th className="w-10" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {filtered.map((company) => (
                  <tr
                    key={company.nif}
                    className="group cursor-pointer border-t border-line hover:bg-subtle/70"
                    onClick={() => navigate(`/empresas/${company.nif}`)}
                  >
                    <td className="px-4 py-4">
                      <Link
                        to={`/empresas/${company.nif}`}
                        className="font-medium group-hover:text-accent"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {company.casualName}
                      </Link>
                      <p className="max-w-56 truncate text-xs text-muted sm:max-w-72">{company.name}</p>
                      <span className="mt-1.5 inline-flex sm:hidden">
                        <Badge tone={companyStatusTone(company.status)} dot>
                          {company.status}
                        </Badge>
                      </span>
                    </td>
                    <td className="hidden px-4 py-4 font-mono text-xs text-muted tabular-nums sm:table-cell">
                      {company.nif}
                    </td>
                    <td className="hidden max-w-72 truncate px-4 py-4 text-muted lg:table-cell" title={company.address ?? undefined}>
                      {company.address ?? '—'}
                    </td>
                    <td className="hidden px-4 py-4 font-mono text-xs md:table-cell">
                      {company.cae ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="hidden px-4 py-4 sm:table-cell">
                      <Badge tone={companyStatusTone(company.status)} dot>
                        {company.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 text-right">
                      {company.pendingProposals > 0 ? (
                        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink tabular-nums">
                          {company.pendingProposals}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="pr-3" aria-hidden>
                      <ChevronRight className="size-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function TableSkeleton() {
  return (
    <div>
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-t border-line p-4">
          <div className="flex-1">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-2 h-3 w-64" />
          </div>
          <Skeleton className="hidden h-3 w-20 sm:block" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}
