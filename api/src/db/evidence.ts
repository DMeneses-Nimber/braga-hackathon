import type { Database } from './database.js'
import type { Evidence, Search } from '../schemas/index.js'

/** Replaces one company's evidence and keeps everyone else's. Call this inside the lock. */
export async function replaceEvidence(db: Database, nif: string, items: Evidence[]): Promise<Evidence[]> {
  const all = await db.readEvidence()
  const kept = all.filter((item) => item.nif !== nif)
  await db.writeEvidence([...kept, ...items])
  return items
}

/** Every company's evidence, or one company's when a NIF is given. */
export async function listEvidence(db: Database, nif?: string): Promise<Evidence[]> {
  const all = await db.readEvidence()
  if (nif === undefined) return all
  return all.filter((item) => item.nif === nif)
}

/** Replaces one company's searches and keeps everyone else's. Call this inside the lock. */
export async function replaceSearches(db: Database, nif: string, items: Search[]): Promise<Search[]> {
  const all = await db.readSearches()
  const kept = all.filter((item) => item.nif !== nif)
  await db.writeSearches([...kept, ...items])
  return items
}

/** Every company's searches, or one company's when a NIF is given. */
export async function listSearches(db: Database, nif?: string): Promise<Search[]> {
  const all = await db.readSearches()
  if (nif === undefined) return all
  return all.filter((item) => item.nif === nif)
}
