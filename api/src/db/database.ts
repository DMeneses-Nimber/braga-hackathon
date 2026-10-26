import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

import {
  CompaniesFileSchema,
  EvidenceSchema,
  ProposalSchema,
  SearchSchema,
  WeeklyStateSchema,
  type CompaniesFile,
  type Evidence,
  type Proposal,
  type Search,
  type WeeklyState,
} from '../schemas/index.js'
import { fileExists, readJsonFile, writeJsonFile } from './json-file.js'

/** The dataset loaded by default, the hand-checked companies. */
export const DEFAULT_DATASET = 'companies'

const DATASET_NAME = /^[A-Za-z0-9_-]+$/

const EMPTY_SCHEDULE: WeeklyState = {
  enabled: false,
  nextRunAt: null,
  current: null,
  last: null,
}

/**
 * Holds the working copy in data/runtime/ and the proposals in data/summary/summary.json,
 * while the source datasets are only read.
 * Every change runs inside withLock, one at a time, and reads need no lock because files are
 * replaced atomically.
 * withLock must never be called inside withLock.
 */
export class Database {
  readonly dataDir: string
  readonly paths: {
    runtime: string
    companies: string
    evidence: string
    searches: string
    schedule: string
    proposals: string
  }
  private readonly queue: { tail: Promise<void> }

  constructor(dataDir: string) {
    this.dataDir = dataDir
    const runtime = path.join(dataDir, 'runtime')
    this.paths = {
      runtime,
      companies: path.join(runtime, 'companies.json'),
      evidence: path.join(runtime, 'evidence.json'),
      searches: path.join(runtime, 'searches.json'),
      schedule: path.join(runtime, 'schedule.json'),
      proposals: path.join(dataDir, 'summary', 'summary.json'),
    }
    this.queue = { tail: Promise.resolve() }
  }

  /** The hand-checked companies, which the API only reads. */
  get groundTruthFile(): string {
    return path.join(this.dataDir, 'companies', 'companies.json')
  }

  /** Runs fn after the previous change, and keeps the queue going if fn fails. */
  withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.queue.tail.then(() => fn(), () => fn())
    this.queue.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Creates any missing working file. Existing files, including proposals, are kept. */
  async ensureReady(): Promise<void> {
    await this.withLock(async () => {
      if (!(await fileExists(this.paths.companies))) {
        const companies = await this.readDataset(DEFAULT_DATASET)
        await writeJsonFile(this.paths.companies, companies)
      }
      if (!(await fileExists(this.paths.evidence))) await writeJsonFile(this.paths.evidence, [])
      if (!(await fileExists(this.paths.searches))) await writeJsonFile(this.paths.searches, [])
      if (!(await fileExists(this.paths.schedule))) await writeJsonFile(this.paths.schedule, EMPTY_SCHEDULE)
      if (!(await fileExists(this.paths.proposals))) await writeJsonFile(this.paths.proposals, [], 4)
    })
  }

  /** Replaces the working copy with a dataset and empties the evidence, the searches and the proposals. */
  async reset(dataset: string): Promise<{ dataset: string; companies: number }> {
    return this.withLock(async () => {
      const companies = await this.readDataset(dataset)
      await writeJsonFile(this.paths.companies, companies)
      await writeJsonFile(this.paths.evidence, [])
      await writeJsonFile(this.paths.searches, [])
      await writeJsonFile(this.paths.proposals, [], 4)
      return { dataset, companies: Object.keys(companies).length }
    })
  }

  /** The reference dataset, then every file in data/tests/input/, by name. */
  async listDatasets(): Promise<string[]> {
    const names: string[] = []
    if (await fileExists(this.groundTruthFile)) names.push(DEFAULT_DATASET)
    const folder = path.join(this.dataDir, 'tests', 'input')
    try {
      const files = readdirSync(folder)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort()
      names.push(...files)
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT') throw error
    }
    return names
  }

  /** The file of a dataset, or an error that lists the datasets that do exist. */
  datasetFile(name: string): string {
    const file =
      name === DEFAULT_DATASET
        ? this.groundTruthFile
        : path.join(this.dataDir, 'tests', 'input', `${name}.json`)
    if (!DATASET_NAME.test(name) || !existsSync(file)) {
      const available = this.datasetNames()
      throw new Error(`O conjunto de dados "${name}" não existe. Disponíveis: ${available.join(', ')}.`)
    }
    return file
  }

  /** The working copy of the companies. */
  readCompanies(): Promise<CompaniesFile> {
    return readJsonFile(this.paths.companies, CompaniesFileSchema)
  }

  /** Replaces the working copy of the companies. */
  writeCompanies(companies: CompaniesFile): Promise<void> {
    return writeJsonFile(this.paths.companies, companies)
  }

  /** The evidence of the latest verification of each company. */
  readEvidence(): Promise<Evidence[]> {
    return readJsonFile(this.paths.evidence, z.array(EvidenceSchema))
  }

  /** Replaces the evidence file. */
  writeEvidence(evidence: Evidence[]): Promise<void> {
    return writeJsonFile(this.paths.evidence, evidence)
  }

  /** The sources searched in the latest verification of each company. */
  readSearches(): Promise<Search[]> {
    return readJsonFile(this.paths.searches, z.array(SearchSchema))
  }

  /** Replaces the searches file. */
  writeSearches(searches: Search[]): Promise<void> {
    return writeJsonFile(this.paths.searches, searches)
  }

  /** The weekly verification's switch and progress, which a reset leaves alone. */
  readSchedule(): Promise<WeeklyState> {
    return readJsonFile(this.paths.schedule, WeeklyStateSchema)
  }

  /** Replaces the weekly verification's schedule. */
  writeSchedule(schedule: WeeklyState): Promise<void> {
    return writeJsonFile(this.paths.schedule, schedule)
  }

  /** The proposals, oldest first. */
  readProposals(): Promise<Proposal[]> {
    return readJsonFile(this.paths.proposals, z.array(ProposalSchema))
  }

  /** Replaces the proposals file, with the four-space indentation of the original example. */
  writeProposals(proposals: Proposal[]): Promise<void> {
    return writeJsonFile(this.paths.proposals, proposals, 4)
  }

  private readDataset(name: string): Promise<CompaniesFile> {
    return readJsonFile(this.datasetFile(name), CompaniesFileSchema)
  }

  private datasetNames(): string[] {
    const names: string[] = []
    if (existsSync(this.groundTruthFile)) names.push(DEFAULT_DATASET)
    const folder = path.join(this.dataDir, 'tests', 'input')
    if (existsSync(folder)) {
      const files = readdirSync(folder)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .sort()
      names.push(...files)
    }
    return names
  }
}
