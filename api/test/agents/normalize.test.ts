import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { addressParts, normalizeStatus, sameValue, validValue } from '../../src/agents/compare/normalize.js'
import { API_ROOT } from '../../src/config.js'
import { FIELDS, type Company, type Field } from '../../src/schemas/index.js'

async function readJson(file: string): Promise<Record<string, Company>> {
  let text = await readFile(file, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return JSON.parse(text) as Record<string, Company>
}

function differences(dataset: Record<string, Company>, reference: Record<string, Company>): {
  nif: string
  field: Field
  left: string
  right: string
}[] {
  const found = []
  for (const [nif, company] of Object.entries(dataset)) {
    const stored = reference[nif]
    if (!stored) continue
    for (const field of FIELDS) {
      const left = stored[field]
      const right = company[field]
      if (left !== right && typeof left === 'string' && typeof right === 'string') {
        found.push({ nif, field, left, right })
      }
    }
  }
  return found
}

describe('normalisation', () => {
  const referencePath = path.resolve(API_ROOT, '../data/companies/companies.json')

  async function compare(name: string, same: boolean) {
    const reference = await readJson(referencePath)
    const dataset = await readJson(path.resolve(API_ROOT, '../data/tests/input', `${name}.json`))
    const rows = differences(dataset, reference)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(sameValue(row.field, row.left, row.right), `${row.nif} ${row.field}: ${row.left} / ${row.right}`).toBe(same)
    }
  }

  it('caso_2_moradas_formato_diferente: every difference is only of form', () =>
    compare('caso_2_moradas_formato_diferente', true))

  it('caso_5_websites_sem_protocolo: every difference is only of form', () =>
    compare('caso_5_websites_sem_protocolo', true))

  it('caso_1_moradas_diferentes: every difference is a real one', () => compare('caso_1_moradas_diferentes', false))

  it('caso_3_cae_diferentes: every difference is a real one', () => compare('caso_3_cae_diferentes', false))

  it('caso_4_websites_diferentes: every difference is a real one', () => compare('caso_4_websites_diferentes', false))

  it('caso_6_estados_diferentes: every difference is a real one', () => compare('caso_6_estados_diferentes', false))

  it('expands abbreviations and ignores case, accents, punctuation and n.º', () => {
    expect(sameValue('address', 'Av. D. João II, n.º 13, 1999-001 Lisboa', 'AVENIDA DOM JOAO II 13 1999-001 LISBOA')).toBe(true)
    expect(
      sameValue('address', 'Avenida Dom João Ii, Nº 13, 1999-001 São José, Lisboa', 'Avenida D. João II, 13, 1999-001 Lisboa'),
    ).toBe(true)
    const parts = addressParts('R. Prof. Mota Pinto, 42 4100-353 Porto')
    expect(parts.postalCode).toBe('4100-353')
    expect([...parts.words]).toEqual(['rua', 'professor', 'mota', 'pinto', '42', 'porto'])
    expect([...parts.numbers]).toEqual(['42'])
  })

  it('tells apart another postal code, another door number and another street', () => {
    const stored = 'Avenida D. João II, 13, 1999-001 Lisboa'
    expect(sameValue('address', stored, 'Avenida D. João II, 13, 1990-001 Lisboa')).toBe(false)
    expect(sameValue('address', stored, 'Avenida D. João II, 15, 1999-001 Lisboa')).toBe(false)
    expect(sameValue('address', 'Rua Augusta, 10, Lisboa', 'Rua do Ouro, 10, Lisboa')).toBe(false)
  })

  it('tells apart a street with one word changed, even when the rest matches', () => {
    const stored = 'Rua Do Andre Norte, Nº14, Piso 1.2, 1990-266 Lisboa'
    expect(sameValue('address', stored, 'Rua Do Polo Norte, Nº14, Piso 1.2, 1990-266 Lisboa')).toBe(false)
    expect(sameValue('address', stored, 'Rua do Polo Norte Nº14 piso 1.2')).toBe(false)
    expect(sameValue('address', 'Rua do Polo Norte Nº14 piso 1.2', 'Rua Do Polo Norte, Nº14, Piso 1.2, 1990-266 Lisboa')).toBe(true)
  })

  it('needs short addresses to match exactly', () => {
    expect(sameValue('address', 'Lisboa', 'Lisboa, Portugal')).toBe(true)
    expect(sameValue('address', 'Lisboa', 'Porto')).toBe(false)
    expect(sameValue('address', 'Lisboa', 'Avenida D. João II, 13, 1999-001 Lisboa')).toBe(false)
  })

  it('compares websites by host only', () => {
    expect(sameValue('site', 'www.ctt.pt', 'https://ctt.pt/particulares')).toBe(true)
    expect(sameValue('site', 'http://galp.com/pt', 'https://www.galp.com/pt')).toBe(true)
    expect(sameValue('site', 'https://www.ctt.pt', 'https://www.cttexpresso.pt')).toBe(false)
  })

  it('compares the 5 digits of a CAE', () => {
    expect(sameValue('cae', '53100', 'CAE 53100')).toBe(true)
    expect(sameValue('cae', '5310', '5310')).toBe(false)
    expect(sameValue('cae', '64202', '70100')).toBe(false)
  })

  it("maps Google Maps and old spellings to the record's statuses", () => {
    expect(normalizeStatus('OPERATIONAL')).toBe('Ativa')
    expect(normalizeStatus('Activa')).toBe('Ativa')
    expect(normalizeStatus('inactiva')).toBe('Inativa')
    expect(normalizeStatus('em liquidacao')).toBe('Em liquidação')
    expect(normalizeStatus(' CLOSED_PERMANENTLY ')).toBe('CLOSED_PERMANENTLY')
  })

  it('only accepts values the company record takes', () => {
    expect(validValue('cae', '53100')).toBe(true)
    expect(validValue('cae', '5310')).toBe(false)
    expect(validValue('status', 'Cessada')).toBe(true)
    expect(validValue('status', 'CLOSED_PERMANENTLY')).toBe(false)
    expect(validValue('address', '  ')).toBe(false)
  })
})
