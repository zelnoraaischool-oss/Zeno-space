import { memo, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Heart, Eye, Globe, LayoutTemplate, Smartphone, Image as ImageIcon, PlayCircle, Shapes } from 'lucide-react'
import type { Profile, Work, WorkType } from '@/lib/types'
import { WORK_TYPE_LABEL, LIMITS } from '@/lib/constants'
import { formatCount, formatPriceRange } from '@/lib/format'
import { api, errorMessage } from '@/lib/api'
import { useSync } from '@/hooks/useLive'
import { haptic, prefersReducedMotion } from '@/hooks/misc'
import { Avatar, Badge } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { useRequireLogin } from '@/app/session'
import { cn } from '@/lib/cn'

/** 作品の種類の専用アイコン（11.4） */
export function WorkTypeIcon({ type, className }: { type: WorkType; className?: string }) {
  const p = { className: cn('size-3.5', className), strokeWidth: 1.75, 'aria-hidden': true }
  switch (type) {
    case 'hp':
      return <Globe {...p} />
    case 'lp':
      return <LayoutTemplate {...p} />
    case 'app':
      return <Smartphone {...p} />
    case 'image':
      return <ImageIcon {...p} />
    case 'video':
      return <PlayCircle {...p} />
    default:
      return <Shapes {...p} />
  }
}

export function isNew(w: Work): boolean {
  return !!w.publishedAt && Date.now() - new Date(w.publishedAt).getTime() < LIMITS.newBadgeHours * 3600_000
}

/** 1桁ずつ上に回転して増える数字（12.2） */
export function RollingNumber({ value, format = formatCount }: { value: number; format?: (n: number) => string }) {
  const [prev, setPrev] = useState(value)
  const [anim, setAnim] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    if (value === prev) return
    setAnim(value > prev ? 'up' : 'down')
    const t = setTimeout(() => {
      setPrev(value)
      setAnim(null)
    }, 220)
    return () => clearTimeout(t)
  }, [value, prev])
  return (
    <span className="relative inline-flex h-[1.2em] overflow-hidden tabular" aria-live="off">
      <span className={cn('transition-transform duration-200', anim === 'up' && '-translate-y-full', anim === 'down' && 'translate-y-full')}>
        {format(prev)}
      </span>
      {anim && (
        <span
          className={cn('absolute left-0 transition-transform duration-200', anim === 'up' ? 'top-full -translate-y-full' : 'bottom-full translate-y-full')}
        >
          {format(value)}
        </span>
      )}
    </span>
  )
}

/**
 * いいね：即座に反映し、失敗したら元に戻して知らせる（ZS-WORK-12）。
 * ハートが 1.0→1.3→1.0 に弾み、粒子8個が散る（400ms）。
 */
export function LikeButton({
  work,
  size = 'md',
  showCount = false,
  className,
}: {
  work: Work
  size?: 'sm' | 'md' | 'lg'
  showCount?: boolean
  className?: string
}) {
  const likedIds = useSync(() => api.works.likedIds())
  const serverLiked = likedIds.has(work.id)
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [burst, setBurst] = useState(0)
  const [anim, setAnim] = useState<'pop' | 'shrink' | null>(null)
  const toast = useToast()
  const requireLogin = useRequireLogin()
  const liked = optimistic ?? serverLiked
  const shown = count ?? work.likeCount

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    requireLogin({ type: 'like', workId: work.id }, async () => {
      const next = !liked
      setOptimistic(next)
      setCount(shown + (next ? 1 : -1))
      setAnim(next ? 'pop' : 'shrink')
      if (next) {
        setBurst((b) => b + 1)
        haptic(10)
      }
      try {
        await api.works.setLike(work.id, next)
      } catch (err) {
        setOptimistic(!next)
        setCount(shown)
        toast({ text: errorMessage(err).startsWith('ログイン') ? errorMessage(err) : 'いいねを保存できませんでした。もう一度お試しください', tone: 'error' })
      } finally {
        setTimeout(() => {
          setOptimistic(null)
          setCount(null)
        }, 400)
      }
    })
  }

  const icon = size === 'lg' ? 'size-7' : size === 'sm' ? 'size-5' : 'size-6'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={`いいね、${liked ? '選択中' : '未選択'}、${shown}件`}
      className={cn('relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full', className)}
    >
      <span className="relative inline-flex" onAnimationEnd={() => setAnim(null)}>
        <Heart
          className={cn(
            icon,
            'transition-colors duration-150',
            liked ? 'fill-like text-like' : 'text-current',
            anim === 'pop' && 'anim-like-pop',
            anim === 'shrink' && 'anim-like-shrink',
          )}
          strokeWidth={1.75}
        />
        {burst > 0 && !prefersReducedMotion() && <Particles key={burst} />}
      </span>
      {showCount && <RollingNumber value={shown} />}
    </button>
  )
}

function Particles() {
  return (
    <span className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return (
          <span
            key={i}
            className="particle -ml-[3px] -mt-[3px]"
            style={{ ['--dx' as string]: `${Math.cos(a) * 22}px`, ['--dy' as string]: `${Math.sin(a) * 22}px` }}
          />
        )
      })}
    </span>
  )
}

export function CommissionBadge({ owner }: { owner: Profile }) {
  if (owner.commissionStatus === 'open') return <Badge tone="success">受付中</Badge>
  if (owner.commissionStatus === 'consult') return <Badge tone="aurora">相談可</Badge>
  return null
}

function Thumb({ work, className, hoverCycle }: { work: Work; className?: string; hoverCycle?: boolean }) {
  const [i, setI] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const media = work.media
  const start = () => {
    if (!hoverCycle || media.length < 2 || prefersReducedMotion()) return
    timer.current = setInterval(() => setI((x) => (x + 1) % media.length), 1200)
  }
  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    setI(0)
  }
  useEffect(() => () => stop(), [])
  const m = media[i] ?? media[0]
  return (
    <div
      className={cn('relative aspect-[16/10] overflow-hidden', className)}
      style={{ background: m?.dominantColor ?? 'var(--bg-elevated)' }}
      onMouseEnter={start}
      onMouseLeave={stop}
    >
      {m && (
        <img
          src={m.thumbUrl}
          alt={m.altText || work.title}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          style={{ viewTransitionName: `work-${work.id}` }}
        />
      )}
    </div>
  )
}

/** 14.1 作品カード（L / M / S）。一覧・ホーム・関連作品・トークで同じ部品を使う */
export const WorkCard = memo(function WorkCard({ work, owner, size = 'M' }: { work: Work; owner: Profile; size?: 'L' | 'M' | 'S' }) {
  const navigate = useNavigate()
  const techs = useSync(() => api.works.techs())
  const techNames = work.techIds.map((id) => techs.find((t) => t.id === id)?.name).filter(Boolean) as string[]
  const price = formatPriceRange(work.priceMin, work.priceMax)
  const open = (e: React.MouseEvent) => {
    e.preventDefault()
    const go = () => navigate(`/works/${work.id}`)
    // カードのサムネイルがそのまま詳細のメイン画像へ拡大して移る（View Transitions API）
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void }
    if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(go)
    else go()
  }

  if (size === 'S') {
    return (
      <Link
        to={`/works/${work.id}`}
        onClick={open}
        className="card flex w-full items-center gap-3 overflow-hidden p-2 transition-transform duration-150 hover:-translate-y-0.5"
      >
        <Thumb work={work} className="w-28 shrink-0 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-caption text-fg2">
            <WorkTypeIcon type={work.type} /> {WORK_TYPE_LABEL[work.type]}
          </div>
          <p className="line-clamp-2 text-body-m font-bold">{work.title || '無題の作品'}</p>
          <p className="truncate text-caption text-fg2">{owner.displayName}</p>
        </div>
      </Link>
    )
  }

  return (
    <article className={cn('group relative', size === 'L' && 'w-[80vw] max-w-[420px] shrink-0 snap-start sm:w-[360px]')}>
      <Link
        to={`/works/${work.id}`}
        onClick={open}
        className="card block overflow-hidden transition-transform duration-200 ease-out hover:-translate-y-1 focus-visible:-translate-y-1"
      >
        <div className="relative">
          <Thumb work={work} hoverCycle />
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            <Badge tone="dark">
              <WorkTypeIcon type={work.type} /> {WORK_TYPE_LABEL[work.type]}
            </Badge>
            {isNew(work) && (
              <Badge tone="dark" className="text-aurora">
                NEW
              </Badge>
            )}
            {owner.commissionStatus === 'open' && (
              <Badge tone="dark" className="text-success">
                受付中
              </Badge>
            )}
          </div>
        </div>
        <div className="space-y-1.5 p-3">
          <h3 className="line-clamp-2 min-h-[2.75rem] text-body-m font-bold">{work.title}</h3>
          <div className="flex items-center gap-1.5 text-caption text-fg2">
            <Avatar name={owner.displayName} color={owner.avatarColor} url={owner.avatarUrl} size={20} />
            <span className="truncate">{owner.displayName}</span>
          </div>
          {techNames.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {techNames.slice(0, 3).map((t) => (
                <span key={t} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-fg2">
                  {t}
                </span>
              ))}
              {techNames.length > 3 && <span className="px-1 text-[11px] text-fg2">+{techNames.length - 3}</span>}
            </div>
          )}
          <div className="flex items-center gap-3 pt-0.5 text-caption text-fg2 tabular">
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">いいね</span>
              {formatCount(work.likeCount)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">閲覧</span>
              {formatCount(work.viewCount)}
            </span>
            {price && <span className="ml-auto truncate">{price}</span>}
          </div>
        </div>
      </Link>
      <div className="absolute right-1 top-1 rounded-full text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]">
        <LikeButton work={work} />
      </div>
    </article>
  )
})

/** さがすのリスト表示（物件一覧型：14.3） */
export function WorkListRow({ work, owner }: { work: Work; owner: Profile }) {
  const cats = useSync(() => api.works.categories())
  const techs = useSync(() => api.works.techs())
  const price = formatPriceRange(work.priceMin, work.priceMax)
  const period = work.periodValue ? `${work.periodValue}${work.periodUnit === 'day' ? '日' : work.periodUnit === 'week' ? '週' : 'か月'}` : null
  return (
    <article className="card relative flex gap-3 p-2.5">
      <Link to={`/works/${work.id}`} className="absolute inset-0 rounded-[16px]" aria-label={work.title} />
      <div className="w-[120px] shrink-0 overflow-hidden rounded-[10px]">
        <Thumb work={work} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="line-clamp-1 text-body-m font-bold">{work.title}</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-caption text-fg2">
          <dt>種類</dt>
          <dd className="truncate text-fg">
            {WORK_TYPE_LABEL[work.type]}・{cats.find((c) => c.id === work.categoryId)?.name}
          </dd>
          <dt>技術</dt>
          <dd className="truncate text-fg">{work.techIds.map((id) => techs.find((t) => t.id === id)?.name).join('、') || '—'}</dd>
          {period && (
            <>
              <dt>期間</dt>
              <dd className="text-fg">{period}</dd>
            </>
          )}
          <dt>価格帯</dt>
          <dd className="text-fg tabular">{price ?? '—'}</dd>
        </dl>
        <p className="truncate text-caption text-fg2">{owner.displayName}</p>
      </div>
      <div className="relative z-10 self-start">
        <LikeButton work={work} size="sm" />
      </div>
    </article>
  )
}

export function WorkCardSkeleton() {
  return (
    <div className="card overflow-hidden" aria-hidden>
      <div className="skeleton aspect-[16/10]" />
      <div className="space-y-2 p-3">
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
        <div className="skeleton h-3 w-1/3 rounded" />
      </div>
    </div>
  )
}

export function WorkGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5', className)}>{children}</div>
}
