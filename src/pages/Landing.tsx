import { Navigate, useNavigate } from 'react-router-dom'
import { MessageCircle, Search, Newspaper } from 'lucide-react'
import { api } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useMe, useOpenLogin } from '@/app/session'
import { Logo } from '@/components/ui/illustrations'
import { Button } from '@/components/ui/primitives'

/** U-01 ランディング：星空の背景、作品カードが横に流れる帯、「Googleではじめる」 */
export default function Landing() {
  const me = useMe()
  const navigate = useNavigate()
  const openLogin = useOpenLogin()
  const { data } = useLive(() => api.works.list({ sort: 'popular' }, { offset: 0, limit: 12 }), [])
  if (me) return <Navigate to="/home" replace />
  const items = data?.items ?? []
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="stars pointer-events-none absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-brand/25 blur-[120px]" aria-hidden />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <Logo />
        <Button variant="ghost" onClick={() => navigate('/login')}>
          ログイン
        </Button>
      </header>
      <section className="relative mx-auto max-w-6xl px-4 pb-10 pt-10 text-center sm:px-8 sm:pt-20">
        <h1 className="text-[2.25rem] font-bold leading-tight sm:text-[3.5rem]">
          つくったものが、
          <br />
          <span className="text-signature">会話のはじまり</span>になる。
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-body-l text-fg2">
          作品を物件のように並べて見つけ、気になった制作者とそのままチャット。毎朝のAIニュースも届きます。
        </p>
        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3">
          <Button size="lg" variant="signature" onClick={() => navigate('/login')}>
            Googleではじめる
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/search')}>
            ログインせずに作品を見る
          </Button>
        </div>
      </section>
      {items.length > 0 && (
        <div className="relative overflow-hidden py-6" aria-label="作品のサンプル">
          <div className="flex w-max animate-[zs-marquee_60s_linear_infinite] gap-4 motion-reduce:animate-none">
            {[...items, ...items].map(({ work }, i) => (
              <button
                key={`${work.id}-${i}`}
                onClick={() => navigate(`/works/${work.id}`)}
                className="card w-64 shrink-0 overflow-hidden text-left"
                tabIndex={i >= items.length ? -1 : 0}
              >
                <img src={work.media[0]?.thumbUrl} alt="" className="aspect-[16/10] w-full object-cover" loading="lazy" />
                <p className="truncate p-3 text-body-m font-bold">{work.title}</p>
              </button>
            ))}
          </div>
        </div>
      )}
      <section className="relative mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:grid-cols-3 sm:px-8">
        {[
          { icon: MessageCircle, t: 'つながる', d: 'LINE と同じ感覚で話せる。1:1、グループ、既読、リアクション。' },
          { icon: Search, t: '見つける', d: '物件サイトのように作品を探して比べる。条件で絞り込み、いいねで保存。' },
          { icon: Newspaper, t: '届ける', d: '公式アカウントから毎朝のAIニュースとお知らせが届く。' },
        ].map((f) => (
          <div key={f.t} className="card p-5">
            <f.icon className="size-6 text-aurora" strokeWidth={1.75} />
            <h2 className="mt-3 text-title-m">{f.t}</h2>
            <p className="mt-1 text-body-m text-fg2">{f.d}</p>
          </div>
        ))}
      </section>
      <footer className="relative mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-2 px-4 pb-10 text-caption text-fg2 sm:px-8">
        <a href="/legal/terms">利用規約</a>
        <a href="/legal/privacy">プライバシーポリシー</a>
        <a href="/legal/external">外部送信について</a>
        <a href="/legal/guidelines">コミュニティガイドライン</a>
        <button onClick={() => openLogin()} className="ml-auto">
          ログイン
        </button>
      </footer>
    </div>
  )
}
