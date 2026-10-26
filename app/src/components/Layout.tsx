import type { ReactNode } from 'react'
import { Building, ChartColumn, ClipboardCheck, ShieldCheck, User } from 'lucide-react'
import { Link, useLocation } from 'react-router'

import { api } from '../api.js'
import { useApi, useAppState } from '../data.js'
import { missingTools } from '../format.js'
import { Badge, cx, inputClass } from './ui.js'

const NAV = [
  {
    to: '/',
    label: 'Empresas',
    icon: Building,
    active: (path: string) => path === '/' || path.startsWith('/empresas'),
  },
  {
    to: '/propostas',
    label: 'Propostas',
    icon: ClipboardCheck,
    active: (path: string) => path.startsWith('/propostas'),
    count: true,
  },
  {
    to: '/resultados',
    label: 'Resultados',
    icon: ChartColumn,
    active: (path: string) => path.startsWith('/resultados'),
  },
] as const

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const pending = useApi(() => api.listProposals())
  const count = pending.data?.length ?? 0

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link to="/" aria-label="Data Integrity Agent, página inicial" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <span className="hidden leading-tight lg:block">
              <span className="block text-sm font-semibold">Data Integrity</span>
              <span className="block text-xs text-muted">Agent</span>
            </span>
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = item.active(pathname)
              const Icon = item.icon
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                    active
                      ? 'bg-surface text-ink shadow-sm ring-1 ring-line'
                      : 'text-muted hover:bg-subtle hover:text-ink',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{item.label}</span>
                  {'count' in item && count > 0 && (
                    <span className="rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-accent-ink tabular-nums">
                      {count}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <AgentsIndicator />
            <ReviewerField className="hidden md:flex" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  )
}

function AgentsIndicator() {
  const { data } = useApi(() => api.getAgents())
  if (!data) return null
  const lines = data.enabled
    ? [`Recolha: ${data.models.browse}`, `Comparação: ${data.models.compare}`, missingTools(data), data.reason]
    : [data.reason]
  const title = lines.filter((line): line is string => Boolean(line)).join('\n')
  const badge = !data.enabled
    ? { tone: 'warning' as const, text: 'Agentes desligados' }
    : data.offline
      ? { tone: 'info' as const, text: 'Modo offline' }
      : { tone: 'success' as const, text: 'Agentes ligados' }
  return (
    <span title={title}>
      <Badge tone={badge.tone} dot>
        {badge.text}
      </Badge>
    </span>
  )
}

/** The name stored on every approval and rejection. */
export function ReviewerField({ className }: { className?: string }) {
  const { reviewer, setReviewer } = useAppState()
  return (
    <label title="Fica registado em cada aprovação ou rejeição" className={cx('relative', className)}>
      <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        value={reviewer}
        maxLength={100}
        placeholder="O seu nome"
        aria-label="Nome de quem revê"
        onChange={(event) => setReviewer(event.target.value)}
        className={cx(inputClass, 'h-9 w-48 pr-3 pl-9')}
      />
    </label>
  )
}
