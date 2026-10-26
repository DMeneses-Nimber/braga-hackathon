import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { toast } from 'sonner'

import { api, ApiError, toApiError, type Proposal } from './api.js'
import { FIELD_LABELS } from './format.js'

const STORAGE_KEY = 'data-integrity.reviewer'

function readReviewer(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

interface AppState {
  version: number
  refresh: () => void
  reviewer: string
  setReviewer: (name: string) => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const [reviewer, setReviewerState] = useState(readReviewer)
  const refresh = useCallback(() => setVersion((current) => current + 1), [])
  const setReviewer = useCallback((name: string) => {
    setReviewerState(name)
    // If storage is unavailable, the name lasts until the page reloads.
    try {
      localStorage.setItem(STORAGE_KEY, name)
    } catch {
      /* keep the name in memory */
    }
  }, [])
  const value = useMemo(() => ({ version, refresh, reviewer, setReviewer }), [version, refresh, reviewer, setReviewer])
  return <AppContext value={value}>{children}</AppContext>
}

export function useAppState(): AppState {
  const state = useContext(AppContext)
  if (!state) throw new Error('useAppState must be used inside AppProvider')
  return state
}

export function useApi<T>(loader: () => Promise<T>, deps: readonly unknown[] = []) {
  const { version } = useAppState()
  const [data, setData] = useState<T>()
  const [error, setError] = useState<ApiError>()
  const [loading, setLoading] = useState(true)
  const [retryCount, setRetryCount] = useState(0)
  const retry = useCallback(() => setRetryCount((current) => current + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    loader()
      .then((result) => {
        if (!active) return
        setData(result)
        setError(undefined)
        setLoading(false)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(toApiError(caught))
        setData(undefined)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [version, retryCount, ...deps])

  return { data, error, loading, retry }
}

export function useProposalActions() {
  const { refresh, reviewer } = useAppState()

  async function approve(proposal: Proposal): Promise<boolean> {
    try {
      await api.approveProposal(proposal.id, reviewer.trim())
      toast.success(`Proposta ${proposal.id} aprovada`, {
        description: `${proposal.entity} · ${FIELD_LABELS[proposal.field]}: ${proposal.newValue ?? ''}`,
      })
      return true
    } catch (caught) {
      toast.error('Não foi possível aprovar', { description: toApiError(caught).message })
      return false
    } finally {
      refresh()
    }
  }

  async function reject(proposal: Proposal, reason: string): Promise<boolean> {
    try {
      await api.rejectProposal(proposal.id, reason, reviewer.trim())
      toast.success(`Proposta ${proposal.id} rejeitada`, { description: reason })
      return true
    } catch (caught) {
      toast.error('Não foi possível rejeitar', { description: toApiError(caught).message })
      return false
    } finally {
      refresh()
    }
  }

  return { approve, reject }
}
