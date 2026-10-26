import type { Database } from './database.js'
import { proposalNotFound } from '../errors.js'
import type { Proposal, ProposalStatus } from '../schemas/index.js'
import { nextIds } from './ids.js'

/** A proposal before it receives its id. */
export type NewProposal = Omit<Proposal, 'id'>

/** The fields a review may change. */
export interface ProposalReview {
  status?: ProposalStatus
  rejectionReason?: string
  user?: string
}

/** Proposals matching the filter, newest first. */
export async function listProposals(
  db: Database,
  filter: { status?: ProposalStatus; nif?: string },
): Promise<Proposal[]> {
  const all = await db.readProposals()
  const matched = all.filter((proposal) => {
    if (filter.status !== undefined && proposal.status !== filter.status) return false
    if (filter.nif !== undefined && proposal.entityId !== filter.nif) return false
    return true
  })
  return matched.reverse()
}

/** One proposal, or undefined when the id is unknown. */
export async function findProposal(db: Database, id: string): Promise<Proposal | undefined> {
  const all = await db.readProposals()
  return all.find((proposal) => proposal.id === id)
}

/** Appends proposals, giving each the next id. An empty list writes nothing. Call this inside the lock. */
export async function insertProposals(db: Database, items: NewProposal[]): Promise<Proposal[]> {
  if (items.length === 0) return []
  const existing = await db.readProposals()
  const ids = nextIds(
    'p',
    3,
    existing.map((proposal) => proposal.id),
    items.length,
  )
  const created: Proposal[] = []
  for (const [index, item] of items.entries()) {
    const id = ids[index]
    if (id === undefined) throw new Error(`nextIds returned ${ids.length} ids for ${items.length} proposals.`)
    created.push({ id, ...item })
  }
  await db.writeProposals([...existing, ...created])
  return created
}

/** Merges a review into a proposal. Call this inside the lock. */
export async function updateProposal(db: Database, id: string, review: ProposalReview): Promise<Proposal> {
  const proposals = await db.readProposals()
  const index = proposals.findIndex((proposal) => proposal.id === id)
  const current = proposals[index]
  if (current === undefined) throw proposalNotFound(id)
  const updated: Proposal = { ...current }
  if (review.status !== undefined) updated.status = review.status
  if (review.rejectionReason !== undefined) updated.rejectionReason = review.rejectionReason
  if (review.user !== undefined) updated.user = review.user
  proposals[index] = updated
  await db.writeProposals(proposals)
  return updated
}
