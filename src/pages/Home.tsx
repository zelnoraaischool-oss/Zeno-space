import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Sparkles, ChevronDown, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useInfinite } from '@/hooks/useInfinite'
import { useMe } from '@/app/session'
import { PageHeader, BannerStrip } from '@/components/layout/AppLayout'
import { Eyebrow, Logo, OliveBranch } from '@/components/ui/illustrations'
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
      <div className="space-y-12 px-5 py-6 lg:space-y-16 lg:px-12 lg:py-12">
        <Greeting />
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

/** あいさつ：時間帯に合わせた一言を、明朝の見出しと細い線で静かに置く */
function Greeting() {
  const me = useMe()
  const h = Number(new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  const word = h < 5 ? 'こんばんは' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは'
  return (
    <header className="hidden max-w-xl space-y-3 lg:block">
      <Eyebrow>{formatDateLabel(new Date().toISOString())}</Eyebrow>
      <h1 className="text-display">{me ? `${word}、${me.displayName}さん` : 'つくったものが、会話のはじまりになる。'}</h1>
    </header>
  )
}

/** セクション見出し：細い線＋欧文ラベル、明朝の見出し、右に「もっと見る」 */
function Section({ title, eyebrow, more, children }: { title: string; eyebrow: string; more?: { to: string; label?: string }; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1.5">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="text-title-l">{title}</h2>
        </div>
        {more && (
          <Link to={more.to} className="group inline-flex min-h-11 items-center gap-2 text-label text-brand-text">
            <span className="border-b border-current/30 pb-0.5 transition-colors group-hover:border-current">{more.label ?? 'もっと見る'}</span>
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.5} />
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
      <button onClick={() => setRead(null)} className="flex min-h-12 w-full items-center gap-3 border-y border-subtle px-1 text-left">
        <span className="eyebrow shrink-0">AI News</span>
        <span className="flex-1 truncate text-body-m">今日のAIニュース・{data.items[0]?.titleJa}</span>
        <ChevronDown className="size-4 text-fg2" />
      </button>
    )
  return (
    <section className={cn('card relative overflow-hidden p-6 sm:p-8', fresh && 'aurora-ring')} aria-labelledby="news-h">
      <OliveBranch className="pointer-events-none absolute -right-10 -top-6 size-52 rotate-[18deg] text-aurora opacity-25" />
      <div className="relative grid gap-6 lg:grid-cols-[240px_1fr] lg:gap-10">
        <div className="space-y-2">
          <Eyebrow>Today&apos;s AI News</Eyebrow>
          <h2 id="news-h" className="text-title-l">
            今日のAIニュース
          </h2>
          <p className="text-caption tracking-[0.08em] text-fg2">{formatDateLabel(`${data.digest.date}T09:00:00+09:00`)}・{data.items.length}本</p>
        </div>
        <div>
          <ol className="divide-y divide-[var(--border-subtle)] border-y border-subtle">
            {data.items.slice(0, 3).map((n, i) => (
              <li key={n.id} className="flex items-baseline gap-4 py-3 text-body-m">
                <span className="font-serif text-title-m text-brand-text tabular">{String(i + 1).padStart(2, '0')}</span>
                <span className="line-clamp-1 tracking-[0.02em]">{n.titleJa}</span>
              </li>
            ))}
          </ol>
          <Button className="mt-5" variant="secondary" size="sm" onClick={open} icon={<ArrowRight className="size-4" strokeWidth={1.5} />}>
            {data.items.length}本を読む
          </Button>
        </div>
      </div>
    </section>
  )
}

/** ZS-HOME-02 ピックアップ：Lカードの横スクロール。次のカードの端を少し見せる。自動では動かさない */
function Pickup() {
  const { data, loading } = useLive(() => api.works.pickups(), [])
  if (!loading && !data?.length) return null
  return (
    <Section title="ピックアップ" eyebrow="Pick up">
      <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 lg:-mx-12 lg:gap-6 lg:px-12">
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
    <Section title="新着作品" eyebrow="New arrivals" more={{ to: '/search?sort=new' }}>
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
    <Section title="注目の制作者" eyebrow="Creators">
      <div className="no-scrollbar -mx-5 flex gap-4 overflow-x-auto px-5 pb-2 lg:-mx-12 lg:px-12">
        {data.map(({ profile }) => {
          const theirs = works.data?.items.filter((w) => w.owner.id === profile.id).slice(0, 3) ?? []
          return (
            <Link key={profile.id} to={`/u/${profile.handle}`} className="card group w-64 shrink-0 overflow-hidden transition-transform duration-300 hover:-translate-y-1">
              <div className="grid aspect-[16/9] grid-cols-[2fr_1fr] grid-rows-2 gap-px bg-subtle">
                {theirs.map(({ work }, i) => (
                  <img
                    key={work.id}
                    src={work.media[0]?.thumbUrl}
                    alt=""
                    className={cn('size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]', i === 0 && 'row-span-2')}
                    loading="lazy"
                  />
                ))}
              </div>
              <div className="flex items-center gap-3 p-4">
                <Avatar name={profile.displayName} color={profile.avatarColor} url={profile.avatarUrl} size={40} />
                <div className="min-w-0">
                  <p className="truncate font-serif text-body-l font-semibold tracking-[0.08em]">{profile.displayName}</p>
                  <p className="truncate text-caption tracking-[0.04em] text-fg2">{profile.skills.slice(0, 2).join(' / ')}</p>
                </div>
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
    <Section title="あなたへのおすすめ" eyebrow="For you">
      {loggedIn && !hasInterests && (
        <button onClick={() => navigate('/settings/profile#interests')} className="mb-3 flex w-full items-center gap-3 border-y border-subtle px-1 py-4 text-left">
          <Sparkles className="size-5 text-brand-text" strokeWidth={1.5} />
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
