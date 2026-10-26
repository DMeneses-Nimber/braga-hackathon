import { COMPANY_STATUSES, type Field } from '../../schemas/index.js'
import { hostOf } from '../sources.js'

const ABBREVIATIONS: Record<string, string> = {
  av: 'avenida',
  avda: 'avenida',
  r: 'rua',
  lg: 'largo',
  lgo: 'largo',
  pc: 'praca',
  pca: 'praca',
  trav: 'travessa',
  tv: 'travessa',
  estr: 'estrada',
  ed: 'edificio',
  edif: 'edificio',
  prof: 'professor',
  dr: 'doutor',
  dra: 'doutora',
  eng: 'engenheiro',
  d: 'dom',
  sto: 'santo',
  sta: 'santa',
  s: 'sao',
  qta: 'quinta',
  urb: 'urbanizacao',
  calc: 'calcada',
}

const IGNORED = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'portugal'])

/** The postal code, words and door numbers of an address, after abbreviations are expanded. */
export function addressParts(value: string): {
  postalCode: string | null
  words: Set<string>
  numbers: Set<string>
} {
  let text = value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  let postalCode: string | null = null
  text = text.replace(/\d{4}\s*-\s*\d{3}/, (match) => {
    postalCode = match.replace(/\s/g, '')
    return ' '
  })
  text = text.replace(/n\s*\.?\s*[º°]\s*\.?/g, ' ')
  const words = new Set<string>()
  const numbers = new Set<string>()
  for (const piece of text.split(/[^a-z0-9]+/)) {
    if (piece.length === 0) continue
    const word = ABBREVIATIONS[piece] ?? piece
    if (IGNORED.has(word)) continue
    words.add(word)
    if (/^\d+$/.test(word)) numbers.add(word)
  }
  return { postalCode, words, numbers }
}

function sameMembers(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) {
    if (!right.has(item)) return false
  }
  return true
}

/** The same place written differently, such as "Av. D. João II, n.º 13" and "Avenida D. João II, 13". */
export function sameAddress(left: string, right: string): boolean {
  const a = addressParts(left)
  const b = addressParts(right)
  if (a.postalCode && b.postalCode && a.postalCode !== b.postalCode) return false
  if (a.numbers.size > 0 && b.numbers.size > 0 && !sameMembers(a.numbers, b.numbers)) return false
  if (a.words.size === 0 || b.words.size === 0) return false
  const [small, large] = a.words.size <= b.words.size ? [a.words, b.words] : [b.words, a.words]
  // A short address such as "Porto, Portugal" has to match exactly.
  if (small.size < 3) return sameMembers(small, large)
  // More detail ("São José", "piso 1") is the same place, but a different word is not.
  for (const word of small) {
    if (!large.has(word)) return false
  }
  return true
}

/** The same website: protocol, "www." and path are ignored. */
export function sameSite(left: string, right: string): boolean {
  const a = hostOf(left)
  const b = hostOf(right)
  return a !== undefined && a === b
}

/** The same CAE: the first value's digits are exactly five and equal the second value's digits. */
export function sameCae(left: string, right: string): boolean {
  const a = left.replace(/\D/g, '')
  const b = right.replace(/\D/g, '')
  return a.length === 5 && a === b
}

/** A company status when the text means one, otherwise the trimmed text. */
export function normalizeStatus(value: string): string {
  const key = value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (key === 'operational' || key === 'activa') return 'Ativa'
  if (key === 'inactiva') return 'Inativa'
  for (const status of COMPANY_STATUSES) {
    const folded = status.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (folded === key) return status
  }
  return value.trim()
}

/** Whether two values are the same for a field after normalisation. */
export function sameValue(field: Field, left: string, right: string): boolean {
  switch (field) {
    case 'address':
      return sameAddress(left, right)
    case 'site':
      return sameSite(left, right)
    case 'cae':
      return sameCae(left, right)
    case 'status':
      return normalizeStatus(left) === normalizeStatus(right)
  }
}

/** A value the company record accepts for the field. */
export function validValue(field: Field, value: string): boolean {
  const trimmed = value.trim()
  if (field === 'cae') return /^\d{5}$/.test(trimmed)
  if (field === 'status') return (COMPANY_STATUSES as readonly string[]).includes(trimmed)
  return trimmed.length > 0
}
