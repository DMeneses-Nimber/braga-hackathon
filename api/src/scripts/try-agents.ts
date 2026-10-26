/**
 * Runs both agents on one company and prints what they found and decided.
 * The company comes from the working copy.
 * Nothing goes into the evidence or the proposals, but the tool and Grok answers
 * still go into the cache, so the run can be replayed offline.
 */
import { FIELDS } from '../schemas/index.js'
import { createAgents } from '../agents/index.js'
import { loadConfig } from '../config.js'
import { findCompany } from '../db/companies.js'
import { Database } from '../db/database.js'

const nif = process.argv[2]
if (!nif || !/^\d{9}$/.test(nif)) {
  console.error('Indique o NIF: npm run agentes:testar -- 500077568')
  process.exitCode = 1
} else {
  try {
    await main(nif)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

async function main(nif: string): Promise<void> {
  const config = loadConfig()
  const { agents, status } = await createAgents(config.agents)
  if (!agents) throw new Error(status.reason ?? 'Os agentes estão desligados.')
  if (status.reason) console.log(status.reason)

  const db = new Database(config.dataDir)
  await db.ensureReady()
  const company = await findCompany(db, nif)
  if (!company) throw new Error(`Não existe nenhuma empresa com o NIF ${nif} em ${db.paths.runtime}.`)
  console.log(`${company.casualName} (${company.nif})`)
  for (const field of FIELDS) console.log(`  ${field}: ${company[field] ?? ''}`)
  console.log(`Modelos: ${status.models.browse} (recolha), ${status.models.compare} (comparação)`)
  console.log()

  const signal = AbortSignal.timeout(180_000)
  const now = new Date().toISOString()
  const collected = await agents.browse.collect(company, {
    log: (message) => console.log(`[recolha] ${message}`),
    signal,
  })
  const evidence = collected.evidence.map((item) => ({
    ...item,
    nif: company.nif,
    foundAt: item.foundAt ?? now,
  }))
  console.log()
  console.log(`Evidência (${evidence.length}):`)
  for (const item of evidence) {
    console.log(`- ${item.field} [${item.source}] ${item.value}`)
    console.log(`    ${item.url}`)
    console.log(`    "${item.extractProof}"`)
  }

  console.log()
  console.log('Fontes pesquisadas:')
  for (const field of FIELDS) {
    const searches = collected.searches.filter((search) => search.field === field)
    if (searches.length === 0) continue
    const parts = searches.map((search) =>
      search.note ? `${search.source} (${search.outcome}: ${search.note})` : `${search.source} (${search.outcome})`,
    )
    console.log(`- ${field}: ${parts.join(', ')}`)
  }

  const decisions = await agents.compare.compare(company, evidence, {
    log: (message) => console.log(`[comparação] ${message}`),
    signal,
  })
  console.log()
  console.log('Decisões:')
  for (const decision of decisions) {
    const value = decision.newValue ? ` -> "${decision.newValue}"` : ''
    console.log(`- ${decision.field}: ${decision.decision}${value} (atual: "${company[decision.field] ?? ''}")`)
    console.log(`    ${decision.reason}`)
  }
}
