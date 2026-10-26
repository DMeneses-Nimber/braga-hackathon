import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { prettifyError, z } from 'zod'

import { SOURCES, type Source } from '../schemas/index.js'

/** A skill loaded from SKILL.md: its name, description, instructions and folder. */
export interface Skill {
  name: string
  description: string
  instructions: string
  dir: string
}

const sourceEntry = z.object({
  label: z.string().min(1),
  how: z.string().min(1),
  domains: z.array(z.string().min(1)),
})

const sourceList = z.array(z.enum(SOURCES)).min(1)

/** fontes.json: every field's sources, and every source's label, method and domains. */
export const SourcesFileSchema = z.object({
  fields: z.object({
    address: sourceList,
    cae: sourceList,
    site: sourceList,
    status: sourceList,
  }),
  sources: z.object({
    site: sourceEntry,
    googleMaps: sourceEntry,
    teamlyzer: sourceEntry,
    linkedin: sourceEntry,
    instagram: sourceEntry,
    facebook: sourceEntry,
    x: sourceEntry,
    wikipedia: sourceEntry,
    sicae: sourceEntry,
    contribuinte: sourceEntry,
    web: sourceEntry,
  } satisfies Record<Source, typeof sourceEntry>),
})

/** The sources file, with every field and every source present. */
export type SourcesFile = z.infer<typeof SourcesFileSchema>

/** Reads a skill in the Agent Skills format. */
export async function loadSkill(skillsDir: string, name: string): Promise<Skill> {
  const dir = path.join(skillsDir, name)
  let text = await readFile(path.join(dir, 'SKILL.md'), 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/)
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  if (end === -1) {
    throw new Error(`${name}/SKILL.md tem de começar com o cabeçalho "---" com name e description.`)
  }
  const meta = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    const split = line.indexOf(':')
    if (split === -1) continue
    meta.set(line.slice(0, split).trim(), line.slice(split + 1).trim())
  }
  const found = meta.get('name') ?? ''
  if (found !== name) {
    throw new Error(`${name}/SKILL.md tem name: ${found.length > 0 ? found : '(vazio)'}; devia ser ${name}.`)
  }
  return {
    name,
    description: meta.get('description') ?? '',
    instructions: lines.slice(end + 1).join('\n').trim(),
    dir,
  }
}

/** Reads a file inside the skill's folder, as UTF-8. */
export async function readSkillFile(skill: Skill, relative: string): Promise<string> {
  return readFile(path.join(skill.dir, relative), 'utf8')
}

/** Reads and validates the sources file of the browse skill. */
export async function loadSources(skillsDir: string): Promise<SourcesFile> {
  const file = path.join(skillsDir, 'browse-data', 'references', 'fontes.json')
  let text = await readFile(file, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const parsed = SourcesFileSchema.safeParse(JSON.parse(text))
  if (!parsed.success) {
    throw new Error(`browse-data/references/fontes.json não é válido:\n${prettifyError(parsed.error)}`)
  }
  return parsed.data
}
