import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

interface Toast {
  id: number
  text: string
  tone: 'info' | 'error' | 'success'
  action?: { label: string; onClick: () => void }
  ms: number
}

const Ctx = createContext<(t: Omit<Toast, 'id' | 'tone' | 'ms'> & { tone?: Toast['tone']; ms?: number }) => void>(() => {})

/** 取り消せる操作は「元に戻す」付きのトーストを5秒表示する（12.2） */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast, 'id' | 'tone' | 'ms'> & { tone?: Toast['tone']; ms?: number }) => {
    const id = Date.now() + Math.random()
    const toast: Toast = { id, tone: t.tone ?? 'info', ms: t.ms ?? (t.action ? 5000 : 3000), text: t.text, action: t.action }
    setList((l) => [...l.slice(-2), toast])
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), toast.ms)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
          aria-live="polite"
        >
          {list.map((t) => (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'anim-rise pointer-events-auto flex max-w-md items-center gap-3 rounded-[14px] border px-4 py-3 text-body-m shadow-xl',
                t.tone === 'error' ? 'border-danger/40 bg-elevated text-fg' : 'border-subtle bg-elevated text-fg',
              )}
            >
              {t.tone === 'error' && <span className="size-2 shrink-0 rounded-full bg-danger" aria-hidden />}
              {t.tone === 'success' && <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />}
              <span className="flex-1">{t.text}</span>
              {t.action && (
                <button
                  className="min-h-9 shrink-0 rounded-lg px-2 text-label text-brand-text hover:bg-surface"
                  onClick={() => {
                    t.action!.onClick()
                    setList((l) => l.filter((x) => x.id !== t.id))
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  )
}

export function useToast() {
  return useContext(Ctx)
}
