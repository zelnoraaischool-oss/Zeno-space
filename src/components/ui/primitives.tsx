import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'signature' | 'secondary' | 'ghost' | 'danger' | 'warning'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:brightness-110',
  signature: 'bg-signature text-white hover:brightness-110',
  secondary: 'bg-elevated text-fg border border-subtle hover:brightness-110',
  ghost: 'text-fg hover:bg-elevated',
  danger: 'bg-danger text-white hover:brightness-110',
  warning: 'bg-warning text-black hover:brightness-110',
}
const SIZE: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-label',
  md: 'min-h-11 px-4 text-label',
  lg: 'min-h-12 px-6 text-body-l font-bold',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  block?: boolean
}

/** タップ領域は44px以上（15.2 / 2.5.8）。押下は120msで反応 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-btn)] transition-[transform,filter,opacity] duration-100 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; badge?: number | boolean }>(
  function IconButton({ label, badge, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cn(
          'relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg transition-transform duration-100 hover:bg-elevated active:scale-90',
          className,
        )}
        {...rest}
      >
        {children}
        {badge ? (
          typeof badge === 'number' ? (
            <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[11px] font-bold leading-[18px] text-white tabular">
              {badge > 99 ? '99+' : badge}
            </span>
          ) : (
            <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-danger" aria-hidden />
          )
        ) : null}
      </button>
    )
  },
)

export function Chip({
  selected,
  onClick,
  children,
  count,
  disabled,
  className,
}: {
  selected?: boolean
  onClick?: () => void
  children: ReactNode
  count?: number
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-label transition-colors duration-150',
        selected ? 'border-transparent bg-brand text-white' : 'border-subtle bg-surface text-fg hover:bg-elevated',
        disabled && 'opacity-40',
        className,
      )}
    >
      {children}
      {count !== undefined && <span className={cn('tabular text-caption', selected ? 'text-white/80' : 'text-fg2')}>{count}</span>}
    </button>
  )
}

export function Badge({
  tone = 'muted',
  children,
  className,
}: {
  tone?: 'muted' | 'success' | 'aurora' | 'brand' | 'warning' | 'danger' | 'dark'
  children: ReactNode
  className?: string
}) {
  const tones = {
    muted: 'bg-elevated text-fg2',
    success: 'bg-success/15 text-success',
    aurora: 'bg-aurora/15 text-aurora',
    brand: 'bg-brand/20 text-brand-text',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
    dark: 'bg-black/55 text-white backdrop-blur-sm',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold leading-4', tones[tone], className)}>{children}</span>
  )
}

export function Avatar({
  name,
  color,
  url,
  size = 40,
  verified,
  className,
}: {
  name: string
  color?: string
  url?: string | null
  size?: number
  verified?: boolean
  className?: string
}) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className="size-full rounded-full object-cover" loading="lazy" />
      ) : (
        <span
          className="flex size-full items-center justify-center rounded-full font-bold text-white"
          style={{ background: color ?? '#6A4DF5', fontSize: size * 0.42 }}
          aria-hidden
        >
          {name.slice(0, 1)}
        </span>
      )}
      {verified && (
        <span
          className="bg-signature absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full text-white ring-2 ring-[var(--bg-base)]"
          style={{ width: size * 0.38, height: size * 0.38, fontSize: size * 0.22 }}
          aria-label="公式"
        >
          ✓
        </span>
      )}
    </span>
  )
}

export function Spinner({ label = '読み込み中' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="relative inline-block size-8">
      <span className="absolute inset-0 rounded-full border border-fg2/30" />
      <span className="anim-orbit absolute inset-0">
        <span className="bg-signature absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full" />
      </span>
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-[12px]', className)} aria-hidden />
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  description?: string
}) {
  const id = useId()
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-1">
      <label htmlFor={id} className={cn('flex-1', disabled && 'opacity-50')}>
        <span className="block text-body-m">{label}</span>
        {description && <span className="block text-caption text-fg2">{description}</span>}
      </label>
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-elevated border border-subtle',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

interface FieldProps {
  label?: string
  hint?: string
  error?: string | null
  counter?: { value: number; max: number }
  required?: boolean
}

export function Field({ label, hint, error, counter, required, id, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-label">
            {label}
            {required && <span className="ml-1 text-danger">*</span>}
          </label>
          {counter && (
            <span className={cn('tabular text-caption', counter.value > counter.max ? 'text-danger' : 'text-fg2')}>
              {counter.value}/{counter.max}
            </span>
          )}
        </div>
      )}
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-caption text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-fg2">{hint}</p>
      ) : null}
    </div>
  )
}

const inputCls =
  'w-full rounded-[12px] border border-subtle bg-surface px-3.5 py-2.5 text-body-l text-fg placeholder:text-fg2/70 focus:border-brand-text focus:outline-none aria-[invalid=true]:border-danger'

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function TextField(
  { label, hint, error, counter, required, id, className, ...rest },
  ref,
) {
  const autoId = useId()
  const fid = id ?? autoId
  return (
    <Field id={fid} label={label} hint={hint} error={error} counter={counter} required={required}>
      <input
        ref={ref}
        id={fid}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${fid}-err` : undefined}
        className={cn(inputCls, 'min-h-11', className)}
        {...rest}
      />
    </Field>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function TextArea(
  { label, hint, error, counter, required, id, className, ...rest },
  ref,
) {
  const autoId = useId()
  const fid = id ?? autoId
  return (
    <Field id={fid} label={label} hint={hint} error={error} counter={counter} required={required}>
      <textarea ref={ref} id={fid} aria-invalid={!!error || undefined} className={cn(inputCls, 'min-h-24 resize-y', className)} {...rest} />
    </Field>
  )
})

export function Select({
  label,
  value,
  onChange,
  options,
  id,
  hint,
  required,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  id?: string
  hint?: string
  required?: boolean
}) {
  const autoId = useId()
  const fid = id ?? autoId
  return (
    <Field id={fid} label={label} hint={hint} required={required}>
      <select id={fid} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'min-h-11 appearance-none')}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[12px] border border-subtle bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[9px] px-3 text-label transition-colors duration-150',
            size === 'sm' ? 'min-h-8' : 'min-h-10',
            value === o.value ? 'bg-brand text-white' : 'text-fg2 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T
  onChange: (v: T) => void
  tabs: { value: T; label: ReactNode; count?: number }[]
  className?: string
}) {
  return (
    <div role="tablist" className={cn('no-scrollbar flex gap-1 overflow-x-auto', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'relative min-h-11 shrink-0 px-3 text-label transition-colors duration-200',
            value === t.value ? 'text-brand-text' : 'text-fg2 hover:text-fg',
          )}
        >
          {t.label}
          {t.count ? <span className="ml-1 rounded-full bg-danger px-1.5 text-[10px] text-white tabular">{t.count}</span> : null}
          <span
            className={cn(
              'absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-opacity duration-200',
              value === t.value ? 'bg-brand-text opacity-100' : 'opacity-0',
            )}
          />
        </button>
      ))}
    </div>
  )
}

/** ボトムシート（スマホ）／中央モーダル（PC）。Esc で閉じる、フォーカスを閉じ込める */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  full,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('[autofocus], input, textarea, button')?.focus(), 50)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl' }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="anim-fade absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'anim-sheet relative flex w-full flex-col rounded-t-[20px] border border-subtle bg-elevated shadow-2xl sm:rounded-[20px]',
          widths[size],
          full ? 'h-[92dvh] sm:h-auto sm:max-h-[86dvh]' : 'max-h-[86dvh]',
        )}
      >
        <div
          className="flex shrink-0 cursor-grab justify-center pb-1 pt-2 sm:hidden"
          onPointerDown={(e) => (startY.current = e.clientY)}
          onPointerUp={(e) => {
            if (startY.current !== null && e.clientY - startY.current > 60) onClose()
            startY.current = null
          }}
        >
          <span className="h-1 w-10 rounded-full bg-fg2/40" aria-hidden />
        </div>
        {title && (
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 sm:pt-3">
            <h2 className="text-title-m">{title}</h2>
            <IconButton label="閉じる" onClick={onClose}>
              <X className="size-5" strokeWidth={1.75} />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-subtle px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** 確認ダイアログ：選択肢は結果を書く（「はい」「いいえ」は使わない：15.3） */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  danger,
  requireText,
  loading,
}: {
  open: boolean
  onClose: () => void
  title: string
  body?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  danger?: boolean
  requireText?: string
  loading?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            block
            loading={loading}
            onClick={() => {
              if (requireText && inputRef.current?.value !== requireText) {
                inputRef.current?.focus()
                return
              }
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-body-m text-fg2">
        {body}
        {requireText && <TextField ref={inputRef} label={`確認のため「${requireText}」と入力してください`} autoComplete="off" />}
      </div>
    </Sheet>
  )
}
