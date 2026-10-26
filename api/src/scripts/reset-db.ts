/**
 * Rebuilds data/runtime/ from a dataset.
 * The dataset is "companies" (default) or the name of a file in data/tests/input/, without ".json".
 */
import { Database } from '../db/database.js'
import { loadConfig } from '../config.js'

const dataset = process.argv[2] ?? 'companies'
const db = new Database(loadConfig().dataDir)

try {
  const result = await db.reset(dataset)
  console.log(`Cópia de trabalho reposta a partir de "${result.dataset}": ${result.companies} empresas.`)
  console.log(`A evidência e as propostas (${db.paths.proposals}) ficaram vazias.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
