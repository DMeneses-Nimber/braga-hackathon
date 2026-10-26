import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'

import { Info, LoaderCircle, RefreshCw, TriangleAlert, X } from 'lucide-react'

import type { Tone } from '../format.js'

/** Joins class names, skipping empty or false ones. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** The shared look of text fields. */
export const inputClass =
  'rounded-lg border border-line bg-surface text-sm text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20'

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-300',
  accent: 'bg-accent-soft text-accent ring-accent/20',
  success: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
  warning: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
  danger: 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300',
  info: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
}

type IconElement = ReactElement<{ className?: string; 'aria-hidden'?: boolean }>

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'success' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
}

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-accent-ink shadow-sm shadow-accent/25 hover:brightness-110',
  secondary: 'border border-line bg-surface text-ink shadow-sm hover:bg-subtle',
  ghost: 'text-muted hover:bg-subtle hover:text-ink',
  success: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-500',
  danger: 'border border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 dark:text-rose-300',
}

const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  disabled,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-[55%]',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: Tone
  dot?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-md bg-subtle', className)} />
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[30px] sm:leading-9">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      {title}
      {count !== undefined && (
        <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-muted tabular-nums">{count}</span>
      )}
    </h2>
  )
}

export function Stat({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: IconElement
  label: string
  value: ReactNode
  highlight?: boolean
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div
        className={cx(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          highlight ? 'bg-accent text-accent-ink shadow-sm shadow-accent' : 'bg-subtle text-muted',
        )}
      >
        {cloneElement(icon, { className: 'size-5', 'aria-hidden': true })}
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="text-sm text-muted">{label}</p>
      </div>
    </Card>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-subtle p-1">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cx(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
              selected ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function framedIcon(icon: ReactNode, tile: string, glyph: string) {
  const sized = isValidElement<IconElement['props']>(icon)
    ? cloneElement(icon, { className: glyph, 'aria-hidden': true })
    : icon
  return <div className={cx('flex items-center justify-center', tile)}>{sized}</div>
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      {framedIcon(icon, 'size-12 rounded-2xl bg-accent-soft text-accent', 'size-6')}
      <h3 className="mt-4 font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: { message: string }; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-300">
        <TriangleAlert className="size-6" aria-hidden />
      </div>
      <h3 className="mt-4 font-semibold">Algo correu mal</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{error.message}</p>
      {onRetry && (
        <Button className="mt-5" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  )
}

export function Notice({
  title,
  children,
  onDismiss,
}: {
  title: string
  children: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div className="mb-6 flex gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-300" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-muted">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Fechar aviso"
          onClick={onDismiss}
          className="rounded-md p-1 text-muted hover:bg-subtle hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        checked ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-600',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] duration-200',
          checked ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
  )
}
