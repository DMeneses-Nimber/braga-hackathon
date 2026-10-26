import { z } from '@hono/zod-openapi'

import { COMPANY_STATUSES, NifSchema } from './common.js'

/** One of the seven legal statuses. */
export const CompanyStatusSchema = z.enum(COMPANY_STATUSES).openapi({ example: 'Ativa' })

/** A main CAE code: exactly 5 digits. */
export const CaeSchema = z
  .string()
  .regex(/^\d{5}$/, 'A CAE tem de ter 5 dígitos.')
  .openapi({ example: '53100' })

/** A company in the working copy or the reference file. */
export const CompanySchema = z
  .object({
    casualName: z.string().min(1).openapi({ example: 'CTT' }),
    nif: NifSchema,
    name: z.string().min(1).openapi({ example: 'CTT - Correios de Portugal, S.A.' }),
    address: z
      .string()
      .min(1)
      .nullable()
      .openapi({ example: 'Avenida D. João II, 13, 1999-001 Lisboa' }),
    // The test cases hold sites without a protocol, such as "galp.com/pt".
    site: z.string().min(1).nullable().openapi({ example: 'https://www.ctt.pt' }),
    cae: CaeSchema.nullable(),
    status: CompanyStatusSchema,
  })
  .openapi('Empresa')

/** The companies file: one company per NIF, and each key equals that company's NIF. */
export const CompaniesFileSchema = z.record(NifSchema, CompanySchema).superRefine((companies, ctx) => {
  for (const [key, company] of Object.entries(companies)) {
    if (key !== company.nif) {
      ctx.addIssue({
        code: 'custom',
        path: [key, 'nif'],
        message: `A chave ${key} não coincide com o NIF ${company.nif}.`,
      })
    }
  }
})

/** A company record. */
export type Company = z.infer<typeof CompanySchema>

/** The companies file, keyed by NIF. */
export type CompaniesFile = z.infer<typeof CompaniesFileSchema>
