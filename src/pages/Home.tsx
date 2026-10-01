import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Sparkles, ChevronDown } from 'lucide-react'
import { api } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useInfinite } from '@/hooks/useInfinite'
import { useMe } from '@/app/session'
import { PageHeader, BannerStrip } from '@/components/layout/AppLayout'
import { Logo } from '@/components/ui/illustrations'
import { Avatar, Button, Skeleton } from '@/components/ui/primitives'
import { BlockError } from '@/components/ui/states'
import { WorkCard, WorkCardSkeleton, WorkGrid } from '@/components/work/WorkCard'
import { formatDateLabel } from '@/lib/format'
import { cn } from '@/lib/cn'

const READ_KEY = 'zenospace:news-read'

/** U-04 ホーム（14.2）：AIニュース、ピックアップ、新着、注目の制作者、おすすめ */
export default function Home() {
  const me = useMe()
  return (
    <>
      <PageHeader title={<Logo />} hideOnDesktop />
      <div className="space-y-8 px-4 py-4 lg:px-8 lg:py-8">
        <BannerStrip />
        <NewsCard />
        <Pickup />
        <NewWorks />
        <Creators />
        <Recommended hasInterests={!!me?.interests.length} loggedIn={!!me} />
      </div>
    </>
  )
}

function Section({ title, more, children }: { title: string; more?: { to: string; label?: string }; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-title-m">{title}</h2>
        {more && (
          <Link to={more.to} className="inline-flex min-h-11 items-center text-label text-brand-text">
            {more.label ?? 'もっと見る'} <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

/** ZS-HOME-01 今日のAIニュース：届いた直後は縁が光る。読んだ後は1行に折りたたむ */
function NewsCard() {
  const { data, loading, error, reload } = useLive(() => api.news.today(), [])
  const navigate = useNavigate()
  const [read, setRead] = useState(() => {
    try {
      return localStorage.getItem(READ_KEY)
    } catch {
      return null
    }
  })
  if (loading && !data) return <Skeleton className="h-40" />
  if (error) return <BlockError error={error} onRetry={reload} label="AIニュースを読み込めませんでした" />
  if (!data) return null
  const isRead = read === data.digest.id
  const fresh = api.news.isTodayFresh(data.digest)
  const open = () => {
    try {
      localStorage.setItem(READ_KEY, data.digest.id)
    } catch {
      /* noop */
    }
    setRead(data.digest.id)
    navigate('/news')
  }
  if (isRead)
    return (
      <button onClick={() => setRead(null)} className="card flex min-h-12 w-full items-center gap-2 px-4 text-left">
        <Sparkles className="size-4 text-aurora" />
        <span className="flex-1 truncate text-body-m">今日のAIニュース・{data.items[0]?.titleJa}</span>
        <ChevronDown className="size-4 text-fg2" />
      </button>
    )
  return (
    <section className={cn('card relative overflow-hidden p-4 sm:p-5', fresh && 'aurora-ring')} aria-labelledby="news-h">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-aurora/15 blur-3xl" aria-hidden />
      <div className="relative flex items-center gap-2 text-caption text-aurora">
        <Sparkles className="size-4" /> {formatDateLabel(`${data.digest.date}T09:00:00+09:00`)}
      </div>
      <h2 id="news-h" className="relative mt-1 text-title-m">
        今日のAIニュース
      </h2>
      <ol className="relative mt-3 space-y-2">
        {data.items.slice(0, 3).map((n, i) => (
          <li key={n.id} className="flex gap-3 text-body-m">
            <span className="text-signature font-bold tabular">{i + 1}</span>
            <span className="line-clamp-1">{n.titleJa}</span>
          </li>
        ))}
      </ol>
      <Button className="relative mt-4" variant="secondary" size="sm" onClick={open}>
        {data.items.length}本を読む
      </Button>
    </section>
  )
}

/** ZS-HOME-02 ピックアップ：Lカードの横スクロール。次のカードの端を少し見せる。自動では動かさない */
function Pickup() {
  const { data, loading } = useLive(() => api.works.pickups(), [])
  if (!loading && !data?.length) return null
  return (
    <Section title="ピックアップ">
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:-mx-8 lg:px-8">
        {loading && !data
          ? [0, 1].map((i) => <Skeleton key={i} className="aspect-[16/12] w-[80vw] max-w-[420px] shrink-0" />)
          : data!.map(({ work, owner }) => <WorkCard key={work.id} work={work} owner={owner} size="L" />)}
      </div>
    </Section>
  )
}

function NewWorks() {
  const { data, loading, error, reload } = useLive(() => api.works.list({ sort: 'new' }, { offset: 0, limit: 8 }), [])
  return (
    <Section title="新着作品" more={{ to: '/search?sort=new' }}>
      {error ? (
        <BlockError error={error} onRetry={reload} label="新着作品を読み込めませんでした" />
      ) : (
        <WorkGrid>
          {loading && !data
            ? Array.from({ length: 4 }, (_, i) => <WorkCardSkeleton key={i} />)
            : data!.items.map(({ work, owner }) => <WorkCard key={work.id} work={work} owner={owner} />)}
        </WorkGrid>
      )}
    </Section>
  )
}

/** ZS-HOME-05 注目の制作者：直近7日で獲得いいねが多い制作者 */
function Creators() {
  const { data } = useLive(() => api.users.featuredCreators(), [])
  const works = useLive(() => api.works.list({}, { offset: 0, limit: 200 }), [])
  if (!data?.length) return null
  return (
    <Section title="注目の制作者">
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 lg:-mx-8 lg:px-8">
        {data.map(({ profile }) => {
          const theirs = works.data?.items.filter((w) => w.owner.id === profile.id).slice(0, 3) ?? []
          return (
            <Link key={profile.id} to={`/u/${profile.handle}`} className="card w-60 shrink-0 p-3 transition-transform duration-150 hover:-translate-y-0.5">
              <div className="flex items-center gap-2">
                <Avatar name={profile.displayName} color={profile.avatarColor} url={profile.avatarUrl} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-body-m font-bold">{profile.displayName}</p>
                  <p className="truncate text-caption text-fg2">{profile.skills.slice(0, 2).join('・')}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1">
                {theirs.map(({ work }) => (
                  <img key={work.id} src={work.media[0]?.thumbUrl} alt="" className="aspect-square w-full rounded-[8px] object-cover" loading="lazy" />
                ))}
              </div>
            </Link>
          )
        })}
      </div>
    </Section>
  )
}

/** ZS-HOME-04 あなたへのおすすめ（無限スクロールはこのブロックだけ） */
function Recommended({ hasInterests, loggedIn }: { hasInterests: boolean; loggedIn: boolean }) {
  const { items, loading, sentinel, hasMore, error, reload } = useInfinite((offset, limit) => api.works.recommended({ offset, limit }), 'rec', 12)
  const navigate = useNavigate()
  return (
    <Section title="あなたへのおすすめ">
      {loggedIn && !hasInterests && (
        <button onClick={() => navigate('/settings/profile#interests')} className="card mb-3 flex w-full items-center gap-3 border-brand/40 p-4 text-left">
          <Sparkles className="size-5 text-brand-text" />
          <span className="flex-1 text-body-m">興味タグを選ぶと、おすすめが表示されやすくなります</span>
          <ChevronRight className="size-4 text-fg2" />
        </button>
      )}
      {error ? <BlockError error={error} onRetry={reload} label="おすすめを読み込めませんでした" /> : null}
      <WorkGrid>
        {items.map(({ work, owner }) => (
          <WorkCard key={work.id} work={work} owner={owner} />
        ))}
        {loading && Array.from({ length: 4 }, (_, i) => <WorkCardSkeleton key={`s${i}`} />)}
      </WorkGrid>
      {hasMore && <div ref={sentinel} className="h-1" />}
    </Section>
  )
}
