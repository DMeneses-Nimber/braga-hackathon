/**
 * Sample data to try approving and rejecting before the agents exist.
 * Resets the working copy to caso_todos_combinados (which empties summary.json), then runs three
 * scripted verifications, which leave three proposals there. Nothing is searched online.
 */
import type { AgentContext, Agents } from '../agents/types.js'
import { readJsonFile } from '../db/json-file.js'
import { Database } from '../db/database.js'
import { loadConfig } from '../config.js'
import { CompaniesFileSchema, type CompaniesFile, type Decision, type Field, type Source } from '../schemas/index.js'
import { VerificationService } from '../services/verification.js'

interface OtherSource {
  source: Source
  outcome: 'nada' | 'falhou'
  note: string
}

interface Sample {
  nif: string
  field: Field
  decision: Decision
  source: Source
  url: string
  reason: string
  others: OtherSource[]
}

const SAMPLES: Sample[] = [
  {
    nif: '500077568',
    field: 'address',
    decision: 'propor',
    source: 'site',
    url: 'https://exemplo.invalid/ctt/contactos',
    reason: '[exemplo] O site da empresa indica outra morada para a sede.',
    others: [
      { source: 'googleMaps', outcome: 'falhou', note: '[exemplo] A fonte demorou demasiado a responder.' },
      { source: 'wikipedia', outcome: 'nada', note: '[exemplo] A infocaixa só indica a cidade (Lisboa).' },
    ],
  },
  {
    nif: '505060515',
    field: 'cae',
    decision: 'propor',
    source: 'sicae',
    url: 'https://exemplo.invalid/sicae/505060515',
    reason: '[exemplo] O SICAE indica outra CAE principal.',
    others: [{ source: 'contribuinte', outcome: 'nada', note: '[exemplo] O contribuinte.pt não tem a página deste NIF.' }],
  },
  {
    nif: '517157721',
    field: 'status',
    decision: 'rever',
    source: 'web',
    url: 'https://exemplo.invalid/noticias/nimber',
    reason: '[exemplo] Só uma fonte de baixa prioridade diz que a empresa está ativa; precisa de uma pessoa.',
    others: [{ source: 'googleMaps', outcome: 'nada', note: '[exemplo] Nenhum local do Google Maps com este nome.' }],
  },
]

function scriptedAgents(sample: Sample, value: string): Agents {
  return {
    browse: {
      async collect(company, context: AgentContext) {
        context.log('[exemplo] Dados de demonstração; nenhuma fonte foi consultada.')
        return {
          evidence: [
            {
              field: sample.field,
              value,
              source: sample.source,
              url: sample.url,
              extractProof: value,
            },
          ],
          searches: [
            { field: sample.field, source: sample.source, outcome: 'encontrado', urls: [sample.url], note: null },
            ...sample.others.map((other) => ({
              field: sample.field,
              source: other.source,
              outcome: other.outcome,
              urls: other.outcome === 'nada' ? [`https://exemplo.invalid/${other.source}/${sample.nif}`] : [],
              note: other.note,
            })),
          ],
        }
      },
    },
    compare: {
      async compare(_company, evidence, context) {
        context.log('[exemplo] Decisão de demonstração.')
        const excerpt = evidence[0]?.extractProof ?? value
        return [
          {
            field: sample.field,
            decision: sample.decision,
            newValue: value,
            source: sample.source,
            url: sample.url,
            extractProof: excerpt,
            reason: sample.reason,
          },
        ]
      },
    },
  }
}

function referenceValue(reference: CompaniesFile, sample: Sample): string {
  const company = reference[sample.nif]
  const value = company?.[sample.field]
  if (typeof value !== 'string') throw new Error(`Não há valor de referência para ${sample.nif} (${sample.field}).`)
  return value
}

const config = loadConfig()
const db = new Database(config.dataDir)

try {
  await db.reset('caso_todos_combinados')
  const reference = await readJsonFile(db.groundTruthFile, CompaniesFileSchema)
  for (const sample of SAMPLES) {
    const value = referenceValue(reference, sample)
    const service = new VerificationService(db, scriptedAgents(sample, value), () => new Date())
    const result = await service.verify(sample.nif)
    for (const proposal of result.proposals) {
      console.log(
        `${proposal.id}  ${proposal.entity}, ${proposal.field}: "${proposal.currentValue}" -> "${proposal.newValue}"`,
      )
    }
  }
  console.log('Exemplos criados sobre "caso_todos_combinados". Experimente em http://localhost:3000/api/docs')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
