import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { useSync } from '@/hooks/useLive'
import { Sheet } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { LoginPanel } from '@/components/auth/LoginPanel'
import type { Profile } from '@/lib/types'

export type PendingAction =
  { type: 'like'; workId: string } | { type: 'inquiry'; workId: string } | { type: 'friend'; userId: string } | { type: 'nav'; to: string }

const PENDING_KEY = 'zenospace:pending-action'

interface SessionCtx {
  openLogin: (pending?: PendingAction) => void
}
const Ctx = createContext<SessionCtx>({ openLogin: () => {} })

export function useMe(): Profile | null {
  return useSync(() => api.users.me())
}

/**
 * 未ログインで操作した場合はログインシートを開き、
 * ログイン後に元の操作（いいね、問い合わせ）を自動で完了させる（14.4）。
 */
export function useRequireLogin() {
  const { openLogin } = useContext(Ctx)
  return useCallback(
    (pending: PendingAction, run: () => void | Promise<void>) => {
      if (api.users.me()) void run()
      else openLogin(pending)
    },
    [openLogin],
  )
}

export function useOpenLogin() {
  return useContext(Ctx).openLogin
}

export function savePending(p: PendingAction | null) {
  try {
    if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p))
    else sessionStorage.removeItem(PENDING_KEY)
  } catch {
    /* noop */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const me = useMe()

  const openLogin = useCallback((pending?: PendingAction) => {
    savePending(pending ?? null)
    setOpen(true)
  }, [])

  // ログイン直後に保留中の操作を完了させる
  useEffect(() => {
    if (!me || !me.onboarded) return
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(PENDING_KEY)
    } catch {
      /* noop */
    }
    if (!raw) return
    savePending(null)
    const p = JSON.parse(raw) as PendingAction
    void (async () => {
      try {
        if (p.type === 'like') {
          await api.works.setLike(p.workId, true)
          toast({ text: 'いいねしました', tone: 'success' })
        } else if (p.type === 'inquiry') {
          const roomId = await api.chat.openInquiry(p.workId)
          navigate(`/talk/${roomId}?inquiry=1`)
        } else if (p.type === 'friend') {
          await api.users.addFriend(p.userId)
          toast({ text: '友だちに追加しました', tone: 'success' })
        } else if (p.type === 'nav') navigate(p.to)
      } catch (e) {
        toast({ text: errorMessage(e), tone: 'error' })
      }
    })()
  }, [me, navigate, toast])

  return (
    <Ctx.Provider value={{ openLogin }}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} title="ログインして続ける" size="sm">
        <LoginPanel
          compact
          onDone={(needsOnboarding) => {
            setOpen(false)
            if (needsOnboarding) navigate('/onboarding')
          }}
        />
      </Sheet>
    </Ctx.Provider>
  )
}

/** 表示設定（テーマ・文字サイズ・アニメーションを減らす：ZS-SET-03）を <html> に反映する */
export function DisplaySettingsSync() {
  const settings = useSync(() => api.users.settings())
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const pref = settings?.theme ?? 'system'
      const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.dataset.theme = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B0D17' : '#F7F8FC')
    }
    apply()
    root.dataset.textSize = settings?.textSize ?? 'normal'
    root.dataset.reduceMotion = String(settings?.reduceMotion ?? false)
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [settings?.theme, settings?.textSize, settings?.reduceMotion])
  return null
}
