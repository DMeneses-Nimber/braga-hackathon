import { useEffect, useRef, type ReactNode } from 'react'

import { TriangleAlert, X } from 'lucide-react'

import { Button } from './ui.js'

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy = false,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean
  title: string
  confirmLabel: string
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      // Opening it modally focuses its first button, «Fechar», so Enter never confirms by accident.
      element.showModal()
    } else if (!open && element.open) {
      element.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      onClose={onClose}
      className="w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <TriangleAlert className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-lg font-semibold">
              {title}
            </h2>
            <div className="mt-2 space-y-2 text-sm text-muted">{children}</div>
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
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
