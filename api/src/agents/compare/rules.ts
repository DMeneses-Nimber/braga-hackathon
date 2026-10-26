import type { Decision, Evidence, Field, FieldDecision, Source } from '../../schemas/index.js'
import type { SourceCatalog } from '../sources.js'
import { normalizeStatus, sameValue, validValue } from './normalize.js'

/** What the model answered for one field, before the fixed rules. */
export interface ModelDecision {
  field: Field
  decision: Decision
  value: string | null
  source: Source | null
  url: string | null
  excerpt: string | null
  reason: string
}

/**
 * The fixed rules of regras.md. They always have the last word:
 * the model's answer is kept only when a rule doesn't replace it.
 */
export function applyRules(
  field: Field,
  stored: string | null,
  evidence: Evidence[],
  model: ModelDecision,
  catalog: SourceCatalog,
): FieldDecision {
  let decision = model.decision
  let value = model.value
  let reason = model.reason
  const changing = (): boolean => decision === 'propor' || decision === 'rever'
  if (field === 'status' && changing() && value !== null) value = normalizeStatus(value)

  const shows = (item: Evidence): boolean => value !== null && sameValue(field, item.value, value)
  const chosen = (item: Evidence): boolean => item.url === model.url && item.extractProof === model.excerpt
  const cited =
    evidence.find((item) => chosen(item) && shows(item)) ??
    evidence.find(shows) ??
    evidence.find(chosen) ??
    (decision === 'manter' || decision === 'ignorar' ? evidence.find((item) => item.url === model.url) : undefined)

  if (changing() && value !== null && stored !== null && sameValue(field, stored, value)) {
    decision = 'manter'
    value = null
    reason = 'Igual ao valor guardado depois de normalizado.'
  } else if (changing() && value !== null && !validValue(field, value)) {
    reason = `${reason} O valor "${value}" não é válido para este campo.`
    decision = 'rever'
    value = null
  } else if (decision === 'propor' && value !== null) {
    const supporting = evidence.filter(shows)
    const kinds = [...new Set(supporting.map((item) => item.source))]
    if (supporting.length === 0) {
      const closed =
        field === 'status' &&
        evidence.some(
          (item) =>
            item.source === 'googleMaps' &&
            (item.value.trim().toLowerCase() === 'closed_permanently' ||
              item.value.trim().toLowerCase() === 'closed_temporarily'),
        )
      reason = closed
        ? `${reason} O Google Maps só diz que o local fechou, não que a empresa mudou de estado.`
        : `${reason} Nenhuma evidência mostra este valor.`
      decision = 'rever'
    } else if (supporting.every((item) => item.source === 'web')) {
      decision = 'rever'
      reason = `${reason} Só há evidência de outros sites.`
    } else if (!supporting.some((item) => catalog.rank(field, item.source) === 1) && kinds.length < 2) {
      decision = 'rever'
      reason = `${reason} Só uma fonte o indica, e não é a principal deste campo.`
    }
  }

  if (decision !== 'propor' && decision !== 'rever') value = null
  return {
    field,
    decision,
    newValue: value,
    source: cited?.source ?? null,
    url: cited?.url ?? null,
    extractProof: cited?.extractProof ?? null,
    reason: reason.trim(),
  }
}
