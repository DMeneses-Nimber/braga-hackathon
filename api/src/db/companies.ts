import type { Database } from './database.js'
import { ApiError, companyNotFound, describeIssues } from '../errors.js'
import { CompanySchema, FIELD_LABELS, type Company, type Field } from '../schemas/index.js'

/** The companies in the order of the file's keys. */
export async function listCompanies(db: Database): Promise<Company[]> {
  const companies = await db.readCompanies()
  return Object.values(companies)
}

/** One company, or undefined when the NIF is not in the working copy. */
export async function findCompany(db: Database, nif: string): Promise<Company | undefined> {
  const companies = await db.readCompanies()
  return companies[nif]
}

/** Replaces one field of a company. Call this inside the database lock. */
export async function updateCompanyField(
  db: Database,
  nif: string,
  field: Field,
  value: string | null,
): Promise<Company> {
  const companies = await db.readCompanies()
  const company = companies[nif]
  if (!company) throw companyNotFound(nif)
  const updated = { ...company, [field]: value }
  const parsed = CompanySchema.safeParse(updated)
  if (!parsed.success) {
    throw new ApiError(
      422,
      'VALOR_INVALIDO',
      `O valor "${value}" não é válido para o campo ${FIELD_LABELS[field]}.`,
      describeIssues(parsed.error.issues),
    )
  }
  companies[nif] = parsed.data
  await db.writeCompanies(companies)
  return parsed.data
}
