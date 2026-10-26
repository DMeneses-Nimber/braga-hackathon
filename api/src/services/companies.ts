import type { Database } from '../db/database.js'
import { findCompany, listCompanies } from '../db/companies.js'
import { listEvidence, listSearches } from '../db/evidence.js'
import { listProposals } from '../db/proposals.js'
import { companyNotFound } from '../errors.js'
import type { CompanyDetail, CompanyListItem } from '../schemas/index.js'

/** Every company, with its pending proposals, in Portuguese alphabetical order. */
export async function listCompaniesWithProposals(db: Database): Promise<CompanyListItem[]> {
  const [companies, proposals] = await Promise.all([listCompanies(db), db.readProposals()])
  const pending = new Map<string, number>()
  for (const proposal of proposals) {
    if (proposal.status !== 'pendente') continue
    pending.set(proposal.entityId, (pending.get(proposal.entityId) ?? 0) + 1)
  }
  return companies
    .map((company) => ({ ...company, pendingProposals: pending.get(company.nif) ?? 0 }))
    .sort((left, right) => left.casualName.localeCompare(right.casualName, 'pt'))
}

/** A company with the evidence, searches and proposals of its latest verification. */
export async function getCompanyDetail(db: Database, nif: string): Promise<CompanyDetail> {
  const company = await findCompany(db, nif)
  if (!company) throw companyNotFound(nif)
  const [evidence, searches, proposals] = await Promise.all([
    listEvidence(db, nif),
    listSearches(db, nif),
    listProposals(db, { nif }),
  ])
  return { company, evidence, searches, proposals }
}
