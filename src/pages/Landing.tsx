import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useMe, useOpenLogin } from '@/app/session'
import { Ambient, Eyebrow, Logo, OliveTree } from '@/components/ui/illustrations'
import { Button } from '@/components/ui/primitives'

const PILLARS = [
  { no: '01', en: 'Connect', ja: 'つながる', body: 'いつもの感覚で話せるトーク。1:1、グループ、既読、リアクション。' },
  { no: '02', en: 'Discover', ja: '見つける', body: '物件をさがすように作品を比べる。条件で絞り込み、気に入ったら保存。' },
  { no: '03', en: 'Deliver', ja: '届ける', body: '公式アカウントから、毎朝のAIニュースとお知らせが届く。' },
]

/**
 * U-01 ランディング。
 * 光の差すコンクリートの壁、鉢植えのオリーブ、深緑のロゴと明朝の見出しで、静かな第一印象をつくる。
 */
export default function Landing() {
  const me = useMe()
  const navigate = useNavigate()
  const openLogin = useOpenLogin()
  const { data } = useLive(() => api.works.list({ sort: 'popular' }, { offset: 0, limit: 12 }), [])
  if (me) return <Navigate to="/home" replace />
  const items = data?.items ?? []
  return (
    <div className="relative isolate min-h-dvh overflow-hidden">
      <Ambient />
      {/* 鉢植えのオリーブ（右）と、床の反射 */}
      <OliveTree className="pointer-events-none absolute -right-16 top-24 hidden h-[760px] w-auto opacity-95 md:block lg:right-6" />
      <div className="pointer-events-none absolute inset-x-0 top-[860px] hidden h-px bg-subtle md:block" aria-hidden />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-10">
        <Logo className="sm:invisible" />
        <Button variant="ghost" onClick={() => navigate('/login')}>
          ログイン
        </Button>
      </header>

      <section className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-10 sm:pt-24 lg:pb-28">
        <div className="max-w-2xl">
          <div className="mb-10 hidden sm:block">
            <Logo size="lg" />
          </div>
          <div className="h-px w-28 bg-[var(--text-secondary)] opacity-40" aria-hidden />
          <p className="mt-5 text-label tracking-[0.3em] text-fg2">コンセプト</p>
          <h1 className="mt-3 font-serif text-[1.75rem] font-semibold leading-[1.5] tracking-[0.06em] sm:text-[2.75rem] lg:text-[3rem]">
            つくったものが、
            <br />
            会話のはじまりになる。
          </h1>
          <p className="font-script mt-3 text-[1.875rem] leading-none text-brand-text sm:text-[2.5rem]">where works begin conversations</p>
          <p className="mt-8 max-w-md text-body-l leading-8 tracking-[0.04em] text-fg2">
            作品を物件のように並べて見つけ、気になった制作者とそのまま話せる場所。毎朝のAIニュースも届きます。
          </p>
          <div className="mt-10 flex max-w-sm flex-col gap-3">
            <Button size="lg" variant="signature" className="tracking-[0.1em]" onClick={() => navigate('/login')} icon={<ArrowRight className="size-5" strokeWidth={1.5} />}>
              Googleではじめる
            </Button>
            <Button size="lg" variant="secondary" className="tracking-[0.1em]" onClick={() => navigate('/search')}>
              ログインせずに作品を見る
            </Button>
          </div>
        </div>
      </section>

      {items.length > 0 && (
        <section className="relative border-y border-subtle bg-base/40 py-10 backdrop-blur-[2px]" aria-label="作品のサンプル">
          <div className="mx-auto mb-6 max-w-6xl px-5 sm:px-10">
            <Eyebrow>Works</Eyebrow>
          </div>
          <div className="flex w-max animate-[zs-marquee_80s_linear_infinite] gap-6 motion-reduce:animate-none">
            {[...items, ...items].map(({ work, owner }, i) => (
              <button
                key={`${work.id}-${i}`}
                onClick={() => navigate(`/works/${work.id}`)}
                className="group w-72 shrink-0 text-left"
                tabIndex={i >= items.length ? -1 : 0}
              >
                <div className="overflow-hidden rounded-[var(--radius-card)] border border-subtle">
                  <img src={work.media[0]?.thumbUrl} alt="" className="aspect-[16/10] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" loading="lazy" />
                </div>
                <p className="mt-3 truncate font-serif text-body-l font-semibold tracking-[0.06em]">{work.title}</p>
                <p className="truncate text-caption tracking-[0.04em] text-fg2">{owner.displayName}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="relative mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:grid-cols-3 sm:px-10">
        {PILLARS.map((f) => (
          <div key={f.no} className="space-y-3 border-t border-subtle pt-6">
            <p className="flex items-baseline gap-3">
              <span className="font-serif text-title-m text-brand-text">{f.no}</span>
              <span className="eyebrow">{f.en}</span>
            </p>
            <h2 className="text-title-l">{f.ja}</h2>
            <p className="text-body-m leading-7 tracking-[0.04em] text-fg2">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 border-t border-subtle px-5 py-8 text-caption tracking-[0.06em] text-fg2 sm:px-10">
        <Logo className="mr-auto scale-90" />
        <a href="/legal/terms" className="hover:text-fg">
          利用規約
        </a>
        <a href="/legal/privacy" className="hover:text-fg">
          プライバシーポリシー
        </a>
        <a href="/legal/external" className="hover:text-fg">
          外部送信について
        </a>
        <a href="/legal/guidelines" className="hover:text-fg">
          コミュニティガイドライン
        </a>
        <button onClick={() => openLogin()} className="hover:text-fg">
          ログイン
        </button>
      </footer>
    </div>
  )
}
