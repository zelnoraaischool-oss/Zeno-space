import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Share2, MoreHorizontal, Monitor, Smartphone, ExternalLink, Flag, Link2, X, Pencil, BarChart3, ImageOff, Play } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useMe, useRequireLogin } from '@/app/session'
import { Avatar, Badge, Button, IconButton, Segmented, Sheet, Skeleton } from '@/components/ui/primitives'
import { FullError } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { CommissionBadge, LikeButton, WorkCard, WorkTypeIcon, isNew } from '@/components/work/WorkCard'
import { ShareSheet } from '@/components/work/ShareSheet'
import { ReportSheet } from '@/components/ReportSheet'
import { QrCode } from '@/components/QrCode'
import { Linkified } from '@/components/Linkified'
import { parseMarkup } from '@/lib/markup'
import { PRODUCTION_LABEL, WORK_TYPE_LABEL, PERIOD_UNITS } from '@/lib/constants'
import { formatFullDate, formatPriceRange, formatReplyTime, formatCount } from '@/lib/format'
import type { Work } from '@/lib/types'
import { cn } from '@/lib/cn'

/** U-07 作品詳細（14.4） */
export default function WorkDetail() {
  const { id = '' } = useParams()
  const { data, loading, reload } = useLive(() => api.works.get(id), [id])
  const me = useMe()
  const navigate = useNavigate()
  const [share, setShare] = useState(false)
  const [menu, setMenu] = useState(false)
  const [report, setReport] = useState(false)
  const [solid, setSolid] = useState(false)
  const toast = useToast()
  const requireLogin = useRequireLogin()
  const viewed = useRef<string | null>(null)

  useEffect(() => {
    if (data && viewed.current !== id) {
      viewed.current = id
      void api.works.recordView(id)
    }
  }, [data, id])
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 260)
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  if (loading && !data)
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="aspect-[16/10] w-full" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  if (!data) return <FullError title="作品が見つかりません" body="削除されたか、非公開になった可能性があります" onRetry={reload} />

  const { work, owner } = data
  const own = me?.id === work.ownerId
  const closed = owner.commissionStatus === 'closed'

  const inquire = () =>
    requireLogin({ type: 'inquiry', workId: work.id }, async () => {
      try {
        const roomId = await api.chat.openInquiry(work.id)
        navigate(`/talk/${roomId}?inquiry=1`)
      } catch (e) {
        toast({ text: errorMessage(e), tone: 'error' })
      }
    })

  return (
    <div className="pb-28 lg:pb-10">
      {/* 透明で始まり、ギャラリーを過ぎると背景付きになる */}
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-20 transition-colors duration-200 lg:sticky',
          solid ? 'glass border-b border-subtle' : 'bg-gradient-to-b from-black/50 to-transparent lg:bg-none',
        )}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-2">
          <IconButton label="戻る" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/search'))} className={cn(!solid && 'text-white lg:text-fg')}>
            <ChevronLeft className="size-6" strokeWidth={1.75} />
          </IconButton>
          <p className={cn('min-w-0 flex-1 truncate text-body-m font-bold transition-opacity', solid ? 'opacity-100' : 'opacity-0')}>{work.title}</p>
          <IconButton label="共有" onClick={() => setShare(true)} className={cn(!solid && 'text-white lg:text-fg')}>
            <Share2 className="size-5" strokeWidth={1.75} />
          </IconButton>
          <IconButton label="その他" onClick={() => setMenu(true)} className={cn(!solid && 'text-white lg:text-fg')}>
            <MoreHorizontal className="size-5" strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>

      <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[1fr_340px] lg:gap-8 lg:px-8 lg:pt-4">
        <div className="min-w-0">
          {work.status === 'hidden' && own && (
            <div className="m-4 rounded-[12px] border border-warning/40 bg-warning/10 p-3 text-body-m lg:mx-0">
              この作品は非公開になっています：{work.hiddenReason}
            </div>
          )}
          <Gallery work={work} />
          <div className="space-y-6 px-4 pt-5 lg:px-0">
            <TitleBlock work={work} />
            <SpecTable work={work} />
            <Description text={work.description} ownerId={work.ownerId} />
            <div className="lg:hidden">
              <CreatorCard ownerId={owner.id} />
            </div>
            <Related id={work.id} />
          </div>
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            <CreatorCard ownerId={owner.id} />
            <div className="card space-y-3 p-4">
              {own ? (
                <OwnActions work={work} />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <LikeButton work={work} showCount size="lg" className="text-fg" />
                  </div>
                  <Button variant="signature" size="lg" block disabled={closed} onClick={inquire}>
                    この作品について問い合わせる
                  </Button>
                  {closed && <p className="text-caption text-fg2">現在は依頼を受け付けていません</p>}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* 行動バー（下部固定）：左にいいね、右に問い合わせ */}
      <div className="glass fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 border-t border-subtle px-4 py-2.5 lg:hidden">
        {own ? (
          <OwnActions work={work} />
        ) : (
          <div className="flex items-center gap-3">
            <LikeButton work={work} showCount size="lg" className="text-fg" />
            <div className="flex-1">
              <Button variant="signature" size="lg" block disabled={closed} onClick={inquire}>
                {closed ? '現在は依頼を受け付けていません' : 'この作品について問い合わせる'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ShareSheet open={share} onClose={() => setShare(false)} work={work} />
      <Sheet open={menu} onClose={() => setMenu(false)} size="sm">
        <div className="space-y-1 pt-2">
          <MenuItem
            icon={<Link2 className="size-5" />}
            label="リンクをコピー"
            onClick={async () => {
              await navigator.clipboard?.writeText(`${location.origin}/works/${work.id}`).catch(() => {})
              toast({ text: 'リンクをコピーしました', tone: 'success' })
              setMenu(false)
            }}
          />
          {!own && (
            <MenuItem
              icon={<Flag className="size-5" />}
              label="この作品を通報"
              danger
              onClick={() => {
                setMenu(false)
                requireLogin({ type: 'nav', to: `/works/${work.id}` }, () => setReport(true))
              }}
            />
          )}
        </div>
      </Sheet>
      <ReportSheet open={report} onClose={() => setReport(false)} targetType="work" targetId={work.id} targetLabel="作品" />
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-body-m hover:bg-surface', danger && 'text-danger')}
    >
      {icon}
      {label}
    </button>
  )
}

function OwnActions({ work }: { work: Work }) {
  const navigate = useNavigate()
  return (
    <div className="flex gap-2">
      <Button variant="secondary" block icon={<Pencil className="size-4" />} onClick={() => navigate(`/post/${work.id}`)}>
        編集
      </Button>
      <Button variant="secondary" block icon={<BarChart3 className="size-4" />} onClick={() => navigate(`/me/works?insight=${work.id}`)}>
        インサイト
      </Button>
    </div>
  )
}

/** ギャラリー：左右スワイプ、「3/8」、タップで全画面、ピンチで拡大。HP/LP はライブプレビュー切替 */
function Gallery({ work }: { work: Work }) {
  const [mode, setMode] = useState<'images' | 'preview'>('images')
  const [index, setIndex] = useState(0)
  const [full, setFull] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const isSite = work.type === 'hp' || work.type === 'lp'
  const media = work.media

  return (
    <div className="relative">
      {isSite && (
        <div className="absolute left-1/2 top-16 z-10 -translate-x-1/2 lg:top-3">
          <Segmented
            label="表示"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'images', label: '画像' },
              { value: 'preview', label: 'ライブプレビュー' },
            ]}
          />
        </div>
      )}
      {mode === 'preview' && isSite ? (
        <LivePreview work={work} />
      ) : work.type === 'video' && index === 0 ? (
        <VideoEmbed work={work} onNext={() => setIndex(1)} />
      ) : (
        <>
          <div
            ref={scroller}
            className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto lg:rounded-[16px]"
            onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          >
            {media.map((m, i) => (
              <button
                key={m.id}
                className="w-full shrink-0 snap-center"
                onClick={() => setFull(true)}
                aria-label={`画像 ${i + 1}/${media.length} を全画面で表示`}
              >
                <img
                  src={m.url}
                  alt={m.altText || `画像 ${i + 1}/${media.length}`}
                  className="aspect-[16/10] w-full object-cover"
                  style={{ background: m.dominantColor, viewTransitionName: i === 0 ? `work-${work.id}` : undefined }}
                />
              </button>
            ))}
          </div>
          {media.length > 1 && (
            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-caption text-white tabular">
              {index + 1}/{media.length}
            </span>
          )}
        </>
      )}
      {full && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label="画像ビューア">
          <div className="flex justify-between p-2 text-white">
            <span className="px-3 py-2 text-body-m tabular">
              {index + 1}/{media.length}
            </span>
            <IconButton label="閉じる" className="text-white" onClick={() => setFull(false)}>
              <X className="size-6" />
            </IconButton>
          </div>
          <div className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto" style={{ touchAction: 'pan-x pinch-zoom' }}>
            {media.map((m) => (
              <img key={m.id} src={m.url} alt={m.altText} className="h-full w-full shrink-0 snap-center object-contain" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * ZS-WORK-11 ライブプレビュー：スマホ幅／PC幅のデバイス枠の中に実サイトを表示。
 * 外部送信規律（19.2）：タップしたときに初めて読み込み、読み込み前に「外部サイトの内容を表示します」と示す。
 * iframe は sandbox（スクリプトと同一オリジン動作のみ。トップ移動とポップアップは禁止）。
 */
function LivePreview({ work }: { work: Work }) {
  const [device, setDevice] = useState<'sp' | 'pc'>('sp')
  const [loaded, setLoaded] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <div className="flex flex-col items-center gap-3 bg-surface px-4 pb-6 pt-28 lg:rounded-[16px] lg:pt-16">
      <div className="flex gap-2">
        <Segmented
          label="デバイス"
          size="sm"
          value={device}
          onChange={setDevice}
          options={[
            {
              value: 'sp',
              label: (
                <span className="inline-flex items-center gap-1">
                  <Smartphone className="size-4" />
                  スマホ
                </span>
              ),
            },
            {
              value: 'pc',
              label: (
                <span className="inline-flex items-center gap-1">
                  <Monitor className="size-4" />
                  PC
                </span>
              ),
            },
          ]}
        />
        <a
          href={work.url}
          target="_blank"
          rel="noopener noreferrer ugc"
          className="inline-flex min-h-10 items-center gap-1 rounded-[10px] border border-subtle px-3 text-label"
        >
          サイトを開く <ExternalLink className="size-3.5" />
        </a>
      </div>
      <div
        className={cn(
          'overflow-hidden border-[6px] border-[#1c2038] bg-white shadow-2xl transition-[width,height] duration-300',
          device === 'sp' ? 'h-[560px] w-[300px] rounded-[36px]' : 'aspect-[16/10] w-full max-w-[880px] rounded-[14px]',
        )}
      >
        {!loaded ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 bg-base p-6 text-center">
            <p className="text-body-m text-fg2">外部サイトの内容を表示します</p>
            <Button
              size="sm"
              onClick={() => {
                setLoaded(true)
                // 埋め込みを拒否するサイトは onload が来ないことが多い。5秒で画像表示に切り替える
                timer.current = setTimeout(() => setBlocked(true), 5000)
              }}
            >
              読み込む
            </Button>
          </div>
        ) : blocked ? (
          <div className="relative size-full">
            <img src={work.media[0]?.url} alt="スクリーンショット" className="size-full object-cover object-top" />
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white">
              <ImageOff className="size-3" /> 埋め込めないサイトのため、スクリーンショットを表示しています
            </span>
          </div>
        ) : (
          <iframe
            src={work.url}
            title={`${work.title} のプレビュー`}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-full"
            onLoad={() => timer.current && clearTimeout(timer.current)}
            onError={() => setBlocked(true)}
          />
        )}
      </div>
    </div>
  )
}

function VideoEmbed({ work, onNext }: { work: Work; onNext: () => void }) {
  const [play, setPlay] = useState(false)
  const yt = work.videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/)?.[1]
  const vimeo = work.videoUrl.match(/vimeo\.com\/(\d+)/)?.[1]
  const src = yt ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1` : vimeo ? `https://player.vimeo.com/video/${vimeo}?autoplay=1` : null
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black lg:rounded-[16px]">
      {play && src ? (
        <iframe
          src={src}
          title={work.title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="size-full"
          sandbox="allow-scripts allow-same-origin allow-presentation"
        />
      ) : (
        <button className="group relative size-full" onClick={() => setPlay(true)}>
          <img src={work.media[0]?.url} alt="" className="size-full object-cover opacity-80" />
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
            <span className="flex size-16 items-center justify-center rounded-full bg-black/60 transition-transform group-hover:scale-105">
              <Play className="size-7 fill-white" />
            </span>
            <span className="rounded-full bg-black/60 px-3 py-1 text-caption">外部サイト（{yt ? 'YouTube' : 'Vimeo'}）の内容を表示します</span>
          </span>
        </button>
      )}
      {work.media.length > 1 && (
        <button onClick={onNext} className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-caption text-white">
          画像を見る
        </button>
      )}
    </div>
  )
}

function TitleBlock({ work }: { work: Work }) {
  const cats = useSync(() => api.works.categories())
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="brand">
          <WorkTypeIcon type={work.type} /> {WORK_TYPE_LABEL[work.type]}
        </Badge>
        {work.categoryId && <Badge>{cats.find((c) => c.id === work.categoryId)?.name}</Badge>}
        {isNew(work) && <Badge tone="aurora">NEW</Badge>}
        {work.visibility === 'unlisted' && <Badge tone="warning">限定公開</Badge>}
      </div>
      {/* 長いタイトルも省略せず全文を表示する */}
      <h1 className="text-title-l">{work.title}</h1>
      {work.catchCopy && <p className="text-body-l text-fg2">{work.catchCopy}</p>}
      <p className="text-caption text-fg2 tabular">
        {work.publishedAt ? `${formatFullDate(work.publishedAt)}公開` : '下書き'}・閲覧 {formatCount(work.viewCount)}
      </p>
      {work.type === 'app' && (work.storeUrl || work.url) && (
        <div className="flex items-center gap-4 pt-2">
          <a
            href={work.storeUrl || work.url}
            target="_blank"
            rel="noopener noreferrer ugc"
            className="inline-flex min-h-11 items-center gap-2 rounded-[12px] bg-fg px-4 text-label text-base"
          >
            ストアで見る <ExternalLink className="size-4" />
          </a>
          <QrCode value={work.storeUrl || work.url} size={88} />
        </div>
      )}
    </div>
  )
}

/** スペック表：7.2 の項目を「項目名｜値」の2列。空の項目は出さない */
function SpecTable({ work }: { work: Work }) {
  const cats = useSync(() => api.works.categories())
  const techs = useSync(() => api.works.techs())
  const rows: [string, React.ReactNode][] = [
    ['種類', WORK_TYPE_LABEL[work.type]],
    ['カテゴリ', cats.find((c) => c.id === work.categoryId)?.name],
    [
      '使用技術',
      work.techIds
        .map((id) => techs.find((t) => t.id === id)?.name)
        .filter(Boolean)
        .join('、'),
    ],
    ['制作形態', work.productionType ? PRODUCTION_LABEL[work.productionType] : null],
    ['担当範囲', work.roles.join('、')],
    ['制作期間', work.periodValue ? `${work.periodValue}${PERIOD_UNITS.find((u) => u.value === work.periodUnit)?.label ?? ''}` : null],
    ['参考価格帯', formatPriceRange(work.priceMin, work.priceMax)],
    [
      '公開URL',
      work.url ? (
        <a href={work.url} target="_blank" rel="noopener noreferrer ugc" className="break-all text-brand-text underline">
          {work.url}
        </a>
      ) : null,
    ],
    [
      'タグ',
      work.tags.length ? (
        <span className="flex flex-wrap gap-1">
          {work.tags.map((t) => (
            <Link key={t} to={`/search?tag=${encodeURIComponent(t)}`} className="rounded-full bg-elevated px-2 py-0.5 text-caption text-brand-text">
              #{t}
            </Link>
          ))}
        </span>
      ) : null,
    ],
  ]
  return (
    <section aria-labelledby="spec-h">
      <h2 id="spec-h" className="mb-2 text-title-m">
        作品概要
      </h2>
      <dl className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[96px_1fr] gap-3 px-4 py-3 text-body-m sm:grid-cols-[120px_1fr]">
              <dt className="text-fg2">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
    </section>
  )
}

/** 説明：簡易記法（見出し・箇条書き・リンクのみ）。6行を超えたら「続きを読む」 */
function Description({ text, ownerId }: { text: string; ownerId: string }) {
  const [open, setOpen] = useState(false)
  if (!text.trim()) return null
  const blocks = parseMarkup(text)
  const long = text.split('\n').length > 6 || text.length > 300
  return (
    <section aria-labelledby="desc-h">
      <h2 id="desc-h" className="mb-2 text-title-m">
        説明
      </h2>
      <div className={cn('relative space-y-3 text-body-l', !open && long && 'max-h-[9.75rem] overflow-hidden')}>
        {blocks.map((b, i) =>
          b.type === 'h' ? (
            <h3 key={i} className="text-body-l font-bold">
              {b.text}
            </h3>
          ) : b.type === 'ul' ? (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((it, j) => (
                <li key={j}>
                  <Linkified text={it} senderId={ownerId} />
                </li>
              ))}
            </ul>
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              <Linkified text={b.text} senderId={ownerId} />
            </p>
          ),
        )}
        {!open && long && <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--bg-base)] to-transparent" />}
      </div>
      {long && (
        <button className="mt-1 min-h-11 text-label text-brand-text" onClick={() => setOpen(!open)}>
          {open ? '閉じる' : '続きを読む'}
        </button>
      )}
    </section>
  )
}

/** 制作者カード：「平均返信 3時間以内」のように返信の早さを見せる */
function CreatorCard({ ownerId }: { ownerId: string }) {
  const owner = useSync(() => api.users.profileSync(ownerId))
  const stats = useLive(() => api.users.stats(ownerId), [ownerId])
  if (!owner) return null
  const reply = formatReplyTime(stats.data?.avgReplyMs ?? null)
  return (
    <Link to={`/u/${owner.handle}`} className="card flex items-center gap-3 p-4 transition-colors hover:bg-elevated">
      <Avatar name={owner.displayName} color={owner.avatarColor} url={owner.avatarUrl} size={52} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-body-m font-bold">{owner.displayName}</p>
          <CommissionBadge owner={owner} />
        </div>
        <p className="text-caption text-fg2 tabular">
          作品 {stats.data?.workCount ?? '–'}件{reply && `・平均返信 ${reply}`}
        </p>
      </div>
    </Link>
  )
}

function Related({ id }: { id: string }) {
  const { data } = useLive(() => api.works.related(id), [id])
  if (!data) return null
  return (
    <>
      {data.sameOwner.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-title-m">この制作者の他の作品</h2>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            {data.sameOwner.map(({ work, owner }) => (
              <div key={work.id} className="w-72 shrink-0">
                <WorkCard work={work} owner={owner} size="S" />
              </div>
            ))}
          </div>
        </section>
      )}
      {data.similar.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-title-m">似ている作品</h2>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            {data.similar.map(({ work, owner }) => (
              <div key={work.id} className="w-72 shrink-0">
                <WorkCard work={work} owner={owner} size="S" />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
