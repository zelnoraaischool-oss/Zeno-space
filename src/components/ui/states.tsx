import type { ReactNode } from 'react'
import { WifiOff, Wrench, AlertTriangle, RefreshCw } from 'lucide-react'
import { PlanetArt } from './illustrations'
import { Button } from './primitives'
import { errorMessage } from '@/lib/api'

/** 15.1 状態デザイン：どの状態でも「次にすること」を1つ示す */
export function EmptyState({
  title,
  body,
  action,
  art = 'planet',
}: {
  title: string
  body?: string
  action?: ReactNode
  art?: Parameters<typeof PlanetArt>[0]['variant']
}) {
  return (
    <div className="relative flex flex-col items-center gap-3 overflow-hidden px-6 py-14 text-center">
      <div className="stars pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <PlanetArt variant={art} className="relative text-fg" />
      <p className="relative text-title-m">{title}</p>
      {body && <p className="relative max-w-sm text-body-m text-fg2">{body}</p>}
      {action && <div className="relative mt-2">{action}</div>}
    </div>
  )
}

export function BlockError({ error, onRetry, label }: { error: unknown; onRetry?: () => void; label?: string }) {
  return (
    <div className="card flex items-center gap-3 p-4 text-body-m" role="alert">
      <AlertTriangle className="size-5 shrink-0 text-warning" strokeWidth={1.75} />
      <span className="flex-1 text-fg2">{label ?? errorMessage(error)}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} icon={<RefreshCw className="size-4" />}>
          再試行
        </Button>
      )}
    </div>
  )
}

export function FullError({
  title = '接続が不安定です',
  body = '電波の良い場所で再試行してください',
  onRetry,
}: {
  title?: string
  body?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <PlanetArt className="text-fg" />
      <h1 className="text-title-l">{title}</h1>
      <p className="max-w-sm text-body-m text-fg2">{body}</p>
      <div className="mt-2 flex gap-2">
        {onRetry && <Button onClick={onRetry}>再試行</Button>}
        <Button variant="secondary" onClick={() => (location.href = '/home')}>
          ホームへ戻る
        </Button>
      </div>
    </div>
  )
}

export function OfflineBar() {
  return (
    <div className="anim-drop flex items-center justify-center gap-2 bg-warning px-3 py-1 text-caption text-black" role="status">
      <WifiOff className="size-3.5" strokeWidth={2} /> オフラインです。送信は接続が戻ったら自動で行います
    </div>
  )
}

export function MaintenanceScreen({ until, message }: { until: string | null; message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <Wrench className="size-10 text-aurora" strokeWidth={1.5} />
      <h1 className="text-title-l">ただいまメンテナンス中です{until ? `（${until}終了予定）` : ''}</h1>
      {message && <p className="max-w-md text-body-m text-fg2">{message}</p>}
      <p className="text-caption text-fg2">お知らせは公式アカウントとこの画面でお伝えします。</p>
    </div>
  )
}
