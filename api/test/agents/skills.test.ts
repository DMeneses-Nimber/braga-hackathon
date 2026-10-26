import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createAgents } from '../../src/agents/index.js'
import { loadSkill, loadSources } from '../../src/agents/skills.js'
import type { Source } from '../../src/schemas/index.js'
import { SOURCES, FIELDS } from '../../src/schemas/index.js'
import { SKILLS_DIR, loadCatalog } from './support.js'

const folders: string[] = []

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('skills and sources', () => {
  it('loads both skills with their frontmatter', async () => {
    const browse = await loadSkill(SKILLS_DIR, 'browse-data')
    const compare = await loadSkill(SKILLS_DIR, 'compare-data')
    expect(browse.description).toContain('evidência')
    expect(compare.description).toContain('decide')
    for (const name of ['abrirPagina', 'sicae', 'contribuinte', 'wikipedia', 'googleMaps', 'pesquisarWeb', 'entregarEvidencias']) {
      expect(browse.instructions).toContain(`\`${name}\``)
    }
    for (const decision of ['manter', 'propor', 'ignorar', 'rever']) {
      expect(compare.instructions).toContain(`\`${decision}\``)
    }
    expect(browse.instructions).not.toContain('---')
  })

  it("refuses a SKILL.md whose name is not its folder's", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'dia-skills-'))
    folders.push(folder)
    await mkdir(path.join(folder, 'browse-data'))
    await writeFile(
      path.join(folder, 'browse-data', 'SKILL.md'),
      '---\r\nname: outro\r\ndescription: x\r\n---\r\nCorpo\r\n',
    )
    await expect(loadSkill(folder, 'browse-data')).rejects.toThrow(/devia ser browse-data/)
  })

  it('lists every field and every source in fontes.json', async () => {
    const file = await loadSources(SKILLS_DIR)
    expect(Object.keys(file.fields)).toEqual([...FIELDS])
    expect(Object.keys(file.sources)).toEqual([...SOURCES])
  })

  it("ranks sources in the README's order, unlisted ones with web", async () => {
    const catalog = await loadCatalog()
    expect(catalog.rank('address', 'site')).toBe(1)
    expect(catalog.rank('address', 'googleMaps')).toBe(2)
    expect(catalog.rank('cae', 'sicae')).toBe(1)
    expect(catalog.rank('cae', 'linkedin')).toBe(catalog.rank('cae', 'web'))
    expect(catalog.rank('status', 'googleMaps')).toBe(1)
  })

  it('works out the source from the URL', async () => {
    const catalog = await loadCatalog()
    const hosts = new Set(['ctt.pt'])
    const cases: [string, Source][] = [
      ['https://www.ctt.pt/contactos', 'site'],
      ['https://pt.wikipedia.org/wiki/CTT', 'wikipedia'],
      ['http://www.sicae.pt/Consulta.aspx#nipc=500077568', 'sicae'],
      ['https://maps.google.com/?cid=123', 'googleMaps'],
      ['https://pt.linkedin.com/company/ctt', 'linkedin'],
      ['https://twitter.com/ctt', 'x'],
      ['https://www.cttexpresso.pt', 'web'],
    ]
    for (const [url, source] of cases) expect(catalog.fromUrl(url, hosts)).toBe(source)
  })

  it('describes the sources of every field for the collection agent', async () => {
    const catalog = await loadCatalog()
    const description = catalog.describe()
    expect(description).toContain('### Morada (`address`)')
    expect(description).toContain('1. SICAE (`sicae`)')
  })

  it('leaves the agents off without the Grok key, saying which key is missing', async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dia-cache-'))
    folders.push(cacheDir)
    const { agents, status } = await createAgents({
      grokApiKey: undefined,
      models: { browse: 'grok-4.7', compare: 'grok-4.7' },
      googleMapsApiKey: undefined,
      tavilyApiKey: undefined,
      offline: false,
      maxSteps: 16,
      cacheDir,
      skillsDir: SKILLS_DIR,
    })
    expect(agents).toBeUndefined()
    expect(status.enabled).toBe(false)
    expect(status.offline).toBe(false)
    expect(status.tools).toEqual({ googleMaps: false, webSearch: false })
    expect(status.reason).toContain('XAI_API_KEY')
  })

  it('turns them on with the key, and reports the optional tools', async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dia-cache-'))
    folders.push(cacheDir)
    const models = { browse: 'grok-4.7', compare: 'grok-4.7' }
    const { agents, status } = await createAgents({
      grokApiKey: 'chave',
      models,
      googleMapsApiKey: undefined,
      tavilyApiKey: 'tvly',
      offline: false,
      maxSteps: 16,
      cacheDir,
      skillsDir: SKILLS_DIR,
    })
    expect(agents).toBeDefined()
    expect(status).toEqual({
      enabled: true,
      reason: null,
      models,
      tools: { googleMaps: false, webSearch: true },
      offline: false,
    })
  })

  it('turns them on in offline mode without a key', async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'dia-cache-'))
    folders.push(cacheDir)
    const { agents, status } = await createAgents({
      grokApiKey: undefined,
      models: { browse: 'grok-4.7', compare: 'grok-4.7' },
      googleMapsApiKey: undefined,
      tavilyApiKey: undefined,
      offline: true,
      maxSteps: 16,
      cacheDir,
      skillsDir: SKILLS_DIR,
    })
    expect(agents).toBeDefined()
    expect(status.enabled).toBe(true)
    expect(status.reason).toContain('offline')
  })
})
