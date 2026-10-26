import { ChartColumn } from 'lucide-react'

import { api } from '../api.js'
import { useApi } from '../data.js'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui.js'

const TILES = ['Agentes', 'Referência 1', 'Referência 2']

export function ResultsPage() {
  const evaluation = useApi(() => api.getEvaluation())
  const notReady = evaluation.error?.status === 501

  return (
    <>
      <title>Resultados · Data Integrity Agent</title>
      <PageHeader
        title="Resultados"
        description="Os números dos agentes sobre os casos de teste, comparados com as duas referências."
      />
      {evaluation.loading && !evaluation.data && !evaluation.error ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : notReady ? (
        <Card>
          <EmptyState
            icon={<ChartColumn />}
            title="A avaliação ainda não está disponível"
            description="Os números aparecem aqui quando os agentes e as duas referências existirem."
          />
          <div className="grid grid-cols-1 gap-4 border-t border-line p-5 sm:grid-cols-3">
            {TILES.map((label) => (
              <div key={label} className="rounded-xl border border-dashed border-line p-4">
                <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-muted/60 tabular-nums">— %</p>
                <p className="mt-1 text-xs text-muted">acertos nas decisões</p>
              </div>
            ))}
          </div>
        </Card>
      ) : evaluation.error ? (
        <Card>
          <ErrorState error={evaluation.error} onRetry={evaluation.retry} />
        </Card>
      ) : (
        <Card className="p-5">
          <pre className="overflow-x-auto text-xs">{JSON.stringify(evaluation.data, null, 2)}</pre>
        </Card>
      )}
    </>
  )
}
