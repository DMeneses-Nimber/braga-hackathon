import type { Database } from '../db/database.js'
import { findCompany, updateCompanyField } from '../db/companies.js'
import { findProposal, updateProposal } from '../db/proposals.js'
import { ApiError, companyNotFound, proposalNotFound } from '../errors.js'
import { FIELD_LABELS, type ApproveResult, type Proposal, type RejectResult } from '../schemas/index.js'

const DEFAULT_REVIEWER = 'anónimo'

/** Reviews a proposal. Only an approval changes the working copy. */
export class ReviewService {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  /** Approves a pending proposal and writes the new value onto the company. */
  async approve(id: string, input: { user?: string }): Promise<ApproveResult> {
    return this.db.withLock(async () => {
      const proposal = await this.requirePending(id)
      if (proposal.newValue === null) {
        throw new ApiError(
          422,
          'PROPOSTA_SEM_VALOR',
          `A proposta ${id} não traz um valor novo; só pode ser rejeitada.`,
        )
      }
      const company = await findCompany(this.db, proposal.entityId)
      if (!company) throw companyNotFound(proposal.entityId)
      const currentValue = company[proposal.field]
      // A proposal made against a value that has since changed must not overwrite it.
      if (currentValue !== proposal.currentValue) {
        throw new ApiError(
          409,
          'PROPOSTA_DESATUALIZADA',
          `O campo ${FIELD_LABELS[proposal.field]} de ${company.casualName} mudou desde a proposta ${id}; verifique a empresa de novo.`,
          { proposalCurrentValue: proposal.currentValue, currentValue },
        )
      }
      const updated = await updateCompanyField(this.db, company.nif, proposal.field, proposal.newValue)
      const saved = await updateProposal(this.db, id, {
        status: 'aprovada',
        user: input.user ?? DEFAULT_REVIEWER,
      })
      return { proposal: saved, company: updated }
    })
  }

  /** Rejects a pending proposal. The company stays as it is. */
  async reject(id: string, input: { reason: string; user?: string }): Promise<RejectResult> {
    return this.db.withLock(async () => {
      await this.requirePending(id)
      const proposal = await updateProposal(this.db, id, {
        status: 'rejeitada',
        rejectionReason: input.reason,
        user: input.user ?? DEFAULT_REVIEWER,
      })
      return { proposal }
    })
  }

  private async requirePending(id: string): Promise<Proposal> {
    const proposal = await findProposal(this.db, id)
    if (!proposal) throw proposalNotFound(id)
    if (proposal.status !== 'pendente') {
      throw new ApiError(409, 'PROPOSTA_JA_REVISTA', `A proposta ${id} já foi ${proposal.status}.`, {
        status: proposal.status,
      })
    }
    return proposal
  }
}
