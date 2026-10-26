import type { AgentsStatus, Decision, Field, ProposalStatus, Source, StepAgent } from './api.js'

/** Badge and decision colours. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export const FIELD_LABELS: Record<Field, string> = {
  address: 'Morada',
  cae: 'CAE',
  site: 'Website',
  status: 'Estado',
}

/** The order the company card shows the fields in. */
export const FIELD_ORDER: Field[] = ['address', 'site', 'cae', 'status']

const SOURCE_LABELS: Record<Source, string> = {
  site: 'Site da empresa',
  googleMaps: 'Google Maps',
  teamlyzer: 'Teamlyzer',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  wikipedia: 'Wikipedia',
  sicae: 'SICAE',
  contribuinte: 'contribuinte.pt',
  web: 'Pesquisa web',
}

/** A source's Portuguese name. Unknown sources keep their own text. */
export function sourceLabel(source: string | null): string {
  if (source === null) return 'Sem fonte'
  if (source in SOURCE_LABELS) return SOURCE_LABELS[source as Source]
  return source
}

/** Colour of a company's legal status. */
export function companyStatusTone(status: string): Tone {
  if (status === 'Ativa') return 'success'
  if (status === 'Em liquidação' || status === 'Suspensa') return 'warning'
  if (status === 'Insolvente' || status === 'Cessada' || status === 'Dissolvida') return 'danger'
  return 'neutral'
}

export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  pendente: { label: 'Pendente', tone: 'warning' },
  aprovada: { label: 'Aprovada', tone: 'success' },
  rejeitada: { label: 'Rejeitada', tone: 'danger' },
}

export const DECISIONS: Record<Decision, { label: string; tone: Tone }> = {
  manter: { label: 'Manter', tone: 'neutral' },
  propor: { label: 'Propor', tone: 'accent' },
  ignorar: { label: 'Ignorar', tone: 'neutral' },
  rever: { label: 'Rever', tone: 'warning' },
}

export const STEP_AGENTS: Record<StepAgent, { label: string; dot: string }> = {
  recolha: { label: 'Agente de recolha', dot: 'bg-sky-500' },
  comparacao: { label: 'Agente de comparação', dot: 'bg-violet-500' },
  sistema: { label: 'API', dot: 'bg-slate-400' },
}

/** Portuguese date and time, such as 23/10/2026, 14:05. */
export function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Portuguese time with seconds. */
export function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-PT', { timeStyle: 'medium' }).format(date)
}

/** Sites are stored with or without a protocol, and links need one. */
export function siteHref(site: string): string {
  if (/^https?:\/\//i.test(site)) return site
  return `https://${site}`
}

/** A URL without its protocol or a trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

/** Lower case and without accents, for searching. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/** "<count> <word>", singular only when the count is exactly 1. */
export function plural(count: number, singular: string, pluralWord: string): string {
  return `${count} ${count === 1 ? singular : pluralWord}`
}

/** The optional sources the agents can't use in this API. */
export function missingTools(status: AgentsStatus | undefined): string | undefined {
  if (!status?.enabled) return undefined
  const missing = [
    status.tools.googleMaps ? undefined : 'Google Maps',
    status.tools.webSearch ? undefined : 'pesquisa web',
  ].filter((item): item is string => item !== undefined)
  if (missing.length === 0) return undefined
  if (missing.length === 1) return `sem ${missing[0]}`
  return `sem ${missing[0]} nem ${missing[1]}`
}
