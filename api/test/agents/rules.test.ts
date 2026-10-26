import { describe, expect, it } from 'vitest'

import { applyRules, type ModelDecision } from '../../src/agents/compare/rules.js'
import type { Evidence, Field } from '../../src/schemas/index.js'
import { evidenceItem, loadCatalog } from './support.js'

const STORED = 'Avenida D. João II, 13, 1999-001 Lisboa'
const NEXT = 'Rua Nova, 1, 1000-001 Lisboa'

function propose(field: Field, value: string, item?: Evidence): ModelDecision {
  return {
    field,
    decision: 'propor',
    value,
    source: item?.source ?? null,
    url: item?.url ?? null,
    excerpt: item?.extractProof ?? null,
    reason: 'O modelo propõe.',
  }
}

describe('the fixed rules', () => {
  it("keeps propor backed by the field's top source, citing that evidence", async () => {
    const catalog = await loadCatalog()
    const item = evidenceItem('address', NEXT, 'site', 'https://www.ctt.pt/contactos')
    expect(applyRules('address', STORED, [item], propose('address', NEXT, item), catalog)).toEqual({
      field: 'address',
      decision: 'propor',
      newValue: NEXT,
      source: 'site',
      url: 'https://www.ctt.pt/contactos',
      extractProof: item.extractProof,
      reason: 'O modelo propõe.',
    })
  })

  it('rule 2: the stored value written another way is manter', async () => {
    const catalog = await loadCatalog()
    const item = evidenceItem('address', 'Av. D. João II, n.º 13, 1999-001 Lisboa', 'site')
    const result = applyRules('address', STORED, [item], propose('address', item.value, item), catalog)
    expect(result.decision).toBe('manter')
    expect(result.newValue).toBeNull()
  })

  it('rule 3: an invalid value is rever without a value', async () => {
    const catalog = await loadCatalog()
    const item = evidenceItem('cae', '5310', 'sicae')
    const result = applyRules('cae', '53100', [item], propose('cae', '5310', item), catalog)
    expect(result.decision).toBe('rever')
    expect(result.newValue).toBeNull()
    expect(result.reason).toContain('não é válido')
  })

  it("rule 4: one source that isn't the top one is rever; two that agree are propor", async () => {
    const catalog = await loadCatalog()
    const maps = evidenceItem('address', NEXT, 'googleMaps', 'https://maps.google.com/?cid=1')
    const alone = applyRules('address', STORED, [maps], propose('address', NEXT, maps), catalog)
    expect(alone.decision).toBe('rever')
    const linkedin = evidenceItem('address', 'Rua Nova 1, 1000-001 LISBOA', 'linkedin', 'https://pt.linkedin.com/company/x')
    const together = applyRules('address', STORED, [maps, linkedin], propose('address', NEXT, maps), catalog)
    expect(together.decision).toBe('propor')
  })

  it('rule 5: CLOSED_PERMANENTLY alone is rever', async () => {
    const catalog = await loadCatalog()
    const item = evidenceItem('status', 'CLOSED_PERMANENTLY', 'googleMaps')
    const result = applyRules('status', 'Ativa', [item], propose('status', 'Cessada', item), catalog)
    expect(result.decision).toBe('rever')
    expect(result.newValue).toBe('Cessada')
    expect(result.source).toBe('googleMaps')
    expect(result.reason).toContain('Google Maps')
  })

  it('rule 6: evidence only from other sites is rever', async () => {
    const catalog = await loadCatalog()
    const first = evidenceItem('site', 'https://www.ctt-novo.pt', 'web')
    const second = evidenceItem('site', 'https://ctt-novo.pt/', 'web', 'https://noticias.pt/ctt')
    const result = applyRules('site', 'https://www.ctt.pt', [first, second], propose('site', first.value, first), catalog)
    expect(result.decision).toBe('rever')
    expect(result.reason).toContain('outros sites')
  })

  it('rule 7: a made-up citation is replaced by evidence with the value, or the proposal becomes rever', async () => {
    const catalog = await loadCatalog()
    const item = evidenceItem('cae', '70100', 'sicae', 'http://www.sicae.pt/Consulta.aspx#nipc=500697256')
    const replaced = applyRules(
      'cae',
      '64202',
      [item],
      { ...propose('cae', '70100'), url: 'https://inventado.pt', excerpt: 'inventado' },
      catalog,
    )
    expect(replaced.decision).toBe('propor')
    expect(replaced.url).toBe(item.url)
    expect(replaced.source).toBe('sicae')
    const missing = applyRules('cae', '64202', [item], propose('cae', '35111'), catalog)
    expect(missing.decision).toBe('rever')
    expect(missing.newValue).toBe('35111')
    expect(missing.reason).toContain('Nenhuma evidência')
  })

  it('cites the evidence that shows the proposed value, even when the model cited another', async () => {
    const catalog = await loadCatalog()
    const branch = evidenceItem('address', 'Rua da Loja, 5, 4000-001 Porto', 'site', 'https://www.ctt.pt/lojas')
    const office = evidenceItem('address', NEXT, 'site', 'https://www.ctt.pt/contactos')
    const result = applyRules('address', STORED, [branch, office], propose('address', NEXT, branch), catalog)
    expect(result.url).toBe('https://www.ctt.pt/contactos')
  })

  it("turns Google Maps and old spellings into the record's status", async () => {
    const catalog = await loadCatalog()
    const item = evidenceItem('status', 'OPERATIONAL', 'googleMaps')
    const result = applyRules('status', 'Inativa', [item], propose('status', 'Activa', item), catalog)
    expect(result.decision).toBe('propor')
    expect(result.newValue).toBe('Ativa')
  })

  it('drops the value of manter and ignorar', async () => {
    const catalog = await loadCatalog()
    const branch = evidenceItem('address', 'Rua da Loja, 5, 4000-001 Porto', 'site', 'https://www.ctt.pt/lojas')
    const model: ModelDecision = {
      field: 'address',
      decision: 'ignorar',
      value: branch.value,
      source: branch.source,
      url: branch.url,
      excerpt: branch.extractProof,
      reason: 'É uma loja.',
    }
    const result = applyRules('address', STORED, [branch], model, catalog)
    expect(result.decision).toBe('ignorar')
    expect(result.newValue).toBeNull()
    expect(result.url).toBe(branch.url)
  })
})
