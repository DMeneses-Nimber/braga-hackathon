import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ZodType } from 'zod'

import { ApiError, describeIssues } from '../errors.js'

/** A data file is missing, isn't valid JSON, or doesn't match its schema. */
export class DataFileError extends ApiError {
  constructor(file: string, problem: string, issues?: { path: string; message: string }[]) {
    const base = path.basename(file)
    const details =
      issues !== undefined && issues.length > 0 ? { file: base, issues } : { file: base }
    super(500, 'DADOS_INVALIDOS', `O ficheiro ${base} tem um problema: ${problem}`, details)
    this.name = 'DataFileError'
  }
}

/** Whether the file can be accessed. */
export async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** Reads a JSON file and validates it. A missing file, bad JSON or a schema mismatch is a data error. */
export async function readJsonFile<T>(file: string, schema: ZodType<T>): Promise<T> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') throw new DataFileError(file, 'o ficheiro não existe.')
    throw error
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new DataFileError(file, `JSON inválido (${message}).`)
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new DataFileError(file, 'o conteúdo não respeita o esquema.', describeIssues(parsed.error.issues))
  }
  return parsed.data
}

// On Windows, an editor or antivirus holding the file makes the rename fail for a moment.
async function renameOver(from: string, to: string): Promise<void> {
  const retryable = new Set(['EPERM', 'EBUSY', 'EACCES'])
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
      if (code === undefined || !retryable.has(code) || attempt === 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt))
    }
  }
}

/** Writes JSON atomically. Readers never see a half-written file. */
export async function writeJsonFile(file: string, value: unknown, indentation = 2): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, indentation)}\n`, 'utf8')
  try {
    await renameOver(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
