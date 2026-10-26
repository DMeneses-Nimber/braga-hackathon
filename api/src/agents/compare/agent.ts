import { Output, generateText, type LanguageModel } from 'ai'
import { z } from 'zod'

import {
  DECISIONS,
  FIELDS,
  SOURCES,
  type Company,
  type Evidence,
  type Field,
  type FieldDecision,
} from '../../schemas/index.js'
import type { AgentContext } from '../types.js'
import { FIELD_TITLES, type SourceCatalog } from '../sources.js'
import { sameValue } from './normalize.js'
import { applyRules, type ModelDecision } from './rules.js'

/** What one comparison agent is built from. */
export interface CompareAgentOptions {
  model: LanguageModel
  instructions: string
  sources: SourceCatalog
}

const answerSchema = z.object({
  decisoes: z.array(
    z.object({
      field: z.enum(FIELDS),
      decision: z.enum(DECISIONS),
      newValue: z.string().nullable(),
      url: z.string().nullable(),
      extractProof: z.string().nullable(),
      source: z.enum(SOURCES).nullable(),
      reason: z.string().min(1),
    }),
  ),
})

const FIELD_ORDER: Field[] = ['address', 'cae', 'site', 'status']

/** The comparison agent: obvious fields stay, and the fixed rules override the model. */
export function createCompareAgent(options: CompareAgentOptions) {
  return {
    async compare(company: Company, evidence: Evidence[], context: AgentContext): Promise<FieldDecision[]> {
      const grouped = new Map<Field, Evidence[]>()
      for (const field of FIELD_ORDER) grouped.set(field, [])
      for (const item of evidence) grouped.get(item.field)?.push(item)
      for (const [field, items] of grouped) {
        items.sort((left, right) => options.sources.rank(field, left.source) - options.sources.rank(field, right.source))
      }

      const decided = new Map<Field, FieldDecision>()
      const disputed: Field[] = []
      for (const field of FIELD_ORDER) {
        const items = grouped.get(field) ?? []
        const stored = company[field]
        if (items.length === 0) {
          decided.set(field, empty(field, 'Sem evidência para este campo.'))
          continue
        }
        if (stored !== null && items.every((item) => sameValue(field, stored, item.value))) {
          const labels: string[] = []
          for (const item of items) {
            const label = options.sources.label(item.source)
            if (!labels.includes(label)) labels.push(label)
          }
          const first = items[0]
          decided.set(field, {
            field,
            decision: 'manter',
            newValue: null,
            source: first?.source ?? null,
            url: first?.url ?? null,
            extractProof: first?.extractProof ?? null,
            reason: `Confirmado por ${labels.join(', ')}.`,
          })
          continue
        }
        disputed.push(field)
      }

      if (disputed.length > 0) {
        context.log(`A pedir ao Grok que decida: ${disputed.map((field) => FIELD_TITLES[field]).join(', ')}.`)
        const result = await generateText({
          model: options.model,
          instructions: options.instructions,
          prompt: disputePrompt(company, disputed, grouped, options.sources),
          output: Output.object({ schema: answerSchema }),
          abortSignal: context.signal,
        })
        for (const field of disputed) {
          const answer = result.output.decisoes.find((item) => item.field === field)
          const model: ModelDecision = answer
            ? {
                field,
                decision: answer.decision,
                value: answer.newValue,
                source: answer.source,
                url: answer.url,
                excerpt: answer.extractProof,
                reason: answer.reason,
              }
            : {
                field,
                decision: 'rever',
                value: null,
                source: null,
                url: null,
                excerpt: null,
                reason: 'O modelo não decidiu este campo.',
              }
          decided.set(field, applyRules(field, company[field], grouped.get(field) ?? [], model, options.sources))
        }
      }

      const decisions = FIELD_ORDER.map((field) => decided.get(field) ?? empty(field, 'Sem evidência para este campo.'))
      for (const decision of decisions) {
        const title = FIELD_TITLES[decision.field]
        context.log(
          decision.newValue ? `${title}: ${decision.decision} → ${decision.newValue}.` : `${title}: ${decision.decision}.`,
        )
      }
      return decisions
    },
  }
}

function empty(field: Field, reason: string): FieldDecision {
  return { field, decision: 'manter', newValue: null, source: null, url: null, extractProof: null, reason }
}

function disputePrompt(
  company: Company,
  disputed: Field[],
  grouped: Map<Field, Evidence[]>,
  catalog: SourceCatalog,
): string {
  const blocks = disputed.map((field) => {
    const lines = [
      `## ${FIELD_TITLES[field]} (\`${field}\`)`,
      `Valor guardado: ${company[field] ?? '(sem valor)'}`,
      'Evidências:',
    ]
    for (const [index, item] of (grouped.get(field) ?? []).entries()) {
      lines.push(
        `${index + 1}. [prioridade ${catalog.rank(field, item.source)} · ${catalog.label(item.source)} · source=${item.source}] ${item.value}`,
      )
      lines.push(`   URL: ${item.url}`)
      lines.push(`   Excerto: "${item.extractProof}"`)
    }
    return lines.join('\n')
  })
  return [
    `Empresa: ${company.casualName} (${company.name}), NIF ${company.nif}.`,
    '',
    blocks.join('\n'),
    '',
    `Decide estes campos, e só estes: ${disputed.join(', ')}.`,
  ].join('\n')
}
