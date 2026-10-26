import { ExternalLink, FileSearch } from 'lucide-react'

import type { Evidence, Field, Search, Source } from '../api.js'
import { FIELD_LABELS, FIELD_ORDER, displayUrl, formatDateTime, plural, sourceLabel } from '../format.js'
import { FieldIcon } from './FieldIcon.js'
import { Badge, EmptyState } from './ui.js'

export function EvidenceList({
  evidence,
  searches,
  fields,
}: {
  evidence: Evidence[]
  searches: Search[]
  fields: Field[]
}) {
  const shown = FIELD_ORDER.filter((field) => fields.includes(field))
    .map((field) => groupField(field, evidence, searches))
    .filter((group) => group.found > 0)

  if (shown.length === 0) {
    const any = evidence.length > 0 || searches.length > 0
    return (
      <EmptyState
        icon={<FileSearch />}
        title={any ? 'Nenhum campo com propostas' : 'Ainda sem evidência'}
        description={
          any
            ? 'Aqui só aparecem as fontes dos campos com propostas de alteração, e a última verificação não deixou nenhuma.'
            : 'O que o agente de recolha encontrar na próxima verificação aparece aqui, para os campos com propostas de alteração.'
        }
      />
    )
  }

  return (
    <ul className="divide-y divide-line">
      {shown.map((group) => (
        <li key={group.field} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <FieldIcon field={group.field} className="text-muted" />
              <span className="text-sm font-medium">{FIELD_LABELS[group.field]}</span>
            </div>
            <p className="text-xs text-muted">
              {group.searched > group.found
                ? `${group.found} com resultado · ${group.searched} pesquisadas`
                : plural(group.found, 'fonte com resultado', 'fontes com resultado')}
            </p>
          </div>
          <div className="mt-3 space-y-3">
            {group.sources.map((source) => (
              <div key={source.source} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{sourceLabel(source.source)}</Badge>
                  <span className="text-xs text-muted">{formatDateTime(source.items[0]?.foundAt ?? '')}</span>
                </div>
                {source.items.map((item) => (
                  <div key={`${item.url}-${item.value}`} className="mt-2">
                    <p className="text-sm font-medium break-words">{item.value}</p>
                    <blockquote className="mt-2 border-l-2 border-accent/40 pl-3 text-sm text-muted italic">
                      {`“${item.extractProof}”`}
                    </blockquote>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-medium text-accent hover:underline"
                    >
                      <span className="truncate">{displayUrl(item.url)}</span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}

function groupField(field: Field, evidence: Evidence[], searches: Search[]) {
  const sources: Source[] = []
  for (const search of searches) {
    if (search.field === field && !sources.includes(search.source)) sources.push(search.source)
  }
  for (const item of evidence) {
    if (item.field === field && !sources.includes(item.source)) sources.push(item.source)
  }
  const grouped = sources.map((source) => ({
    source,
    items: evidence.filter((item) => item.field === field && item.source === source),
  }))
  const found = grouped.filter((source) => source.items.length > 0)
  return { field, searched: grouped.length, found: found.length, sources: found }
}
