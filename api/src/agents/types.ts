import type { Company, CollectedEvidence, CollectedSearch, Evidence, FieldDecision } from '../schemas/index.js'

/** What the API hands an agent during a verification; the detail screen shows the steps in order. */
export interface AgentContext {
  log: (message: string) => void
  signal: AbortSignal
}

/** Evidence and every source searched, including the ones where nothing was found. */
export interface BrowseResult {
  evidence: CollectedEvidence[]
  searches: CollectedSearch[]
}

/**
 * "agente de recolha", `.agents/skills/browse-data`: reads the sources of each field in priority
 * order and returns what it found, with a literal excerpt.
 */
export interface BrowseAgent {
  collect: (company: Company, context: AgentContext) => Promise<BrowseResult>
}

/**
 * "agente de comparação", `.agents/skills/compare-data`: compares the evidence with the stored
 * company and returns at most one decision per field.
 */
export interface CompareAgent {
  compare: (company: Company, evidence: Evidence[], context: AgentContext) => Promise<FieldDecision[]>
}

/** The two agents a verification runs, one after the other. */
export interface Agents {
  browse: BrowseAgent
  compare: CompareAgent
}
