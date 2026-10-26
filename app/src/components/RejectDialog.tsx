import { useEffect, useRef, useState, type FormEvent } from 'react'

import { X } from 'lucide-react'

import type { Proposal } from '../api.js'
import { FIELD_LABELS } from '../format.js'
import { Button, cx } from './ui.js'

export function RejectDialog({
  proposal,
  open,
  onClose,
  onConfirm,
}: {
  proposal: Proposal
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<boolean>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const reasonField = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      setReason('')
      element.showModal()
      // React's auto-focus runs when the closed dialog mounts, so it has no effect here.
      requestAnimationFrame(() => reasonField.current?.focus())
    } else if (!open && element.open) {
      element.close()
    }
  }, [open])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) return
    setSaving(true)
    const accepted = await onConfirm(trimmed)
    setSaving(false)
    if (accepted) onClose()
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Rejeitar proposta</h2>
            <p className="mt-1 text-sm text-muted">
              {FIELD_LABELS[proposal.field]} de {proposal.entity} ({proposal.id}). A empresa não muda e o motivo fica
              na proposta.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-subtle hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <label htmlFor={`reason-${proposal.id}`} className="mt-5 block text-sm font-medium">
          Motivo
        </label>
        <textarea
          ref={reasonField}
          id={`reason-${proposal.id}`}
          required
          maxLength={500}
          rows={3}
          value={reason}
          placeholder="Ex.: a morada encontrada é de uma filial."
          onChange={(event) => setReason(event.target.value)}
          className={cx(
            'mt-1.5 w-full resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20',
          )}
        />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" loading={saving} disabled={reason.trim() === ''}>
            Rejeitar proposta
          </Button>
        </div>
      </form>
    </dialog>
  )
}
