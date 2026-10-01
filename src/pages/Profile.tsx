import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MapPin, Link as LinkIcon, MoreHorizontal, UserPlus, UserCheck, MessageCircle, Flag, Ban, EyeOff, QrCode as QrIcon, Pencil } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useMe, useRequireLogin } from '@/app/session'
import { PageHeader } from '@/components/layout/AppLayout'
import { Avatar, Badge, Button, ConfirmDialog, IconButton, Sheet, Skeleton } from '@/components/ui/primitives'
import { EmptyState, FullError } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { CommissionBadge, WorkCard, WorkGrid } from '@/components/work/WorkCard'
import { ReportSheet } from '@/components/ReportSheet'
import { QrCode } from '@/components/QrCode'
import { formatCount, formatReplyTime } from '@/lib/format'
import type { Profile as P } from '@/lib/types'

/** U-16 プロフィール（他の人）：カバー、実績、作品グリッド、友だち追加、メッセージ */
export default function Profile() {
  const { handle = '' } = useParams()
  const { data: profile, loading } = useLive(() => api.users.getProfileByHandle(handle), [handle])
  if (loading && profile === undefined) return <Skeleton className="m-4 h-72" />
  if (!profile) return <FullError title="ユーザーが見つかりません" body="退会したか、表示できないユーザーです" />
  return <ProfileView profile={profile} />
}

export function ProfileView({ profile, self }: { profile: P; self?: boolean }) {
  const me = useMe()
  const isMe = self || me?.id === profile.id
  const stats = useLive(() => api.users.stats(profile.id), [profile.id])
  const works = useLive(() => api.works.list({ ownerId: profile.id }, { offset: 0, limit: 60 }), [profile.id])
  const rel = useSync(() => api.users.relation(profile.id))
  const navigate = useNavigate()
  const toast = useToast()
  const requireLogin = useRequireLogin()
  const [menu, setMenu] = useState(false)
  const [qr, setQr] = useState(false)
  const [report, setReport] = useState(false)
  const [blockConfirm, setBlockConfirm] = useState(false)
  const reply = formatReplyTime(stats.data?.avgReplyMs ?? null)

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast({ text: ok, tone: 'success' })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }

  return (
    <>
      {!self && (
        <PageHeader
          title={profile.displayName}
          back
          actions={
            <IconButton label="その他" onClick={() => setMenu(true)}>
              <MoreHorizontal className="size-5" />
            </IconButton>
          }
        />
      )}
      <div className="mx-auto max-w-5xl">
        <div
          className="relative h-32 overflow-hidden sm:h-48 lg:mt-4 lg:rounded-[16px]"
          style={{ background: profile.coverUrl ? undefined : `linear-gradient(135deg, ${profile.avatarColor}, #22D3EE)` }}
        >
          {profile.coverUrl && <img src={profile.coverUrl} alt="" className="size-full object-cover" />}
        </div>
        <div className="px-4 lg:px-6">
          <div className="-mt-10 flex items-end justify-between gap-3">
            <Avatar
              name={profile.displayName}
              color={profile.avatarColor}
              url={profile.avatarUrl}
              size={88}
              verified={profile.isOfficial}
              className="rounded-full ring-4 ring-[var(--bg-base)]"
            />
            <div className="flex gap-2 pb-1">
              {isMe ? (
                <>
                  <Button variant="secondary" size="sm" icon={<QrIcon className="size-4" />} onClick={() => setQr(true)}>
                    QRコード
                  </Button>
                  <Button variant="secondary" size="sm" icon={<Pencil className="size-4" />} onClick={() => navigate('/settings/profile')}>
                    編集
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant={rel.friend ? 'secondary' : 'primary'}
                    size="sm"
                    icon={rel.friend ? <UserCheck className="size-4" /> : <UserPlus className="size-4" />}
                    onClick={() =>
                      requireLogin({ type: 'friend', userId: profile.id }, () =>
                        run(
                          () => (rel.friend ? api.users.removeFriend(profile.id) : api.users.addFriend(profile.id)),
                          rel.friend ? '友だちから外しました' : '友だちに追加しました',
                        ),
                      )
                    }
                  >
                    {rel.friend ? '友だち' : '友だち追加'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<MessageCircle className="size-4" />}
                    onClick={() =>
                      requireLogin({ type: 'nav', to: `/u/${profile.handle}` }, async () => {
                        try {
                          const id = await api.chat.openDirect(profile.id)
                          navigate(`/talk/${id}`)
                        } catch (e) {
                          toast({ text: errorMessage(e), tone: 'error' })
                        }
                      })
                    }
                  >
                    メッセージ
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-title-l">{profile.displayName}</h1>
              <CommissionBadge owner={profile} />
              {profile.commissionStatus === 'closed' && <Badge>依頼停止中</Badge>}
              {rel.addedMe && !isMe && <Badge tone="brand">あなたを追加しています</Badge>}
            </div>
            <p className="text-body-m text-fg2">@{profile.handle}</p>
            {profile.bio && <p className="whitespace-pre-wrap text-body-l">{profile.bio}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg2">
              {profile.prefecture && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {profile.prefecture}
                </span>
              )}
              {profile.links.map((l) => (
                <a key={l} href={l} target="_blank" rel="noopener noreferrer ugc" className="inline-flex items-center gap-1 text-brand-text">
                  <LinkIcon className="size-3.5" />
                  {l.replace(/^https?:\/\//, '')}
                </a>
              ))}
            </div>
            {profile.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {profile.skills.map((s) => (
                  <Link key={s} to={`/search?q=${encodeURIComponent(s)}`} className="rounded-full bg-elevated px-2.5 py-1 text-caption">
                    {s}
                  </Link>
                ))}
              </div>
            )}
          </div>
          {/* ZS-PROF-03 実績の自動表示 */}
          <dl className="mt-4 grid grid-cols-3 gap-2">
            {[
              ['公開作品', stats.data ? `${stats.data.workCount}` : '–'],
              ['獲得いいね', stats.data ? formatCount(stats.data.likeTotal) : '–'],
              ['平均返信', reply ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="card p-3 text-center">
                <dd className="text-title-m">{v}</dd>
                <dt className="text-caption text-fg2">{k}</dt>
              </div>
            ))}
          </dl>
          <section className="mt-6 pb-6">
            <h2 className="mb-3 text-title-m">作品</h2>
            {works.data?.items.length === 0 ? (
              <EmptyState art="post" title="まだ公開している作品はありません" />
            ) : (
              <WorkGrid>
                {works.data?.items.map(({ work, owner }) => (
                  <WorkCard key={work.id} work={work} owner={owner} />
                ))}
              </WorkGrid>
            )}
          </section>
        </div>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} size="sm">
        <div className="space-y-1 pt-2">
          <button
            className="flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-body-m hover:bg-surface"
            onClick={() => (setMenu(false), setQr(true))}
          >
            <QrIcon className="size-5" /> QRコードを表示
          </button>
          {me && !isMe && rel.friend && (
            <button
              className="flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-body-m hover:bg-surface"
              onClick={() => (
                setMenu(false),
                run(() => api.users.setHidden(profile.id, !rel.hidden), rel.hidden ? '非表示を解除しました' : '非表示にしました')
              )}
            >
              <EyeOff className="size-5" /> {rel.hidden ? '非表示を解除' : '非表示にする'}
            </button>
          )}
          {me && !isMe && (
            <>
              <button
                className="flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-body-m text-danger hover:bg-surface"
                onClick={() => (setMenu(false), rel.blocked ? run(() => api.users.unblock(profile.id), 'ブロックを解除しました') : setBlockConfirm(true))}
              >
                <Ban className="size-5" /> {rel.blocked ? 'ブロックを解除' : 'ブロックする'}
              </button>
              <button
                className="flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-body-m text-danger hover:bg-surface"
                onClick={() => (setMenu(false), setReport(true))}
              >
                <Flag className="size-5" /> 通報する
              </button>
            </>
          )}
        </div>
      </Sheet>
      <Sheet open={qr} onClose={() => setQr(false)} title="プロフィールQRコード" size="sm">
        <div className="flex flex-col items-center gap-3 pb-4">
          <QrCode value={`${location.origin}/u/${profile.handle}`} size={220} />
          <p className="text-body-m">@{profile.handle}</p>
          <p className="text-caption text-fg2">読み取ると友だち追加の画面が開きます</p>
        </div>
      </Sheet>
      <ConfirmDialog
        open={blockConfirm}
        onClose={() => setBlockConfirm(false)}
        title={`${profile.displayName}さんをブロックしますか？`}
        body="ブロックした相手からのメッセージ、友だち追加、プロフィールの閲覧を止めます。相手には通知されません。"
        confirmLabel="ブロックする"
        danger
        onConfirm={() => {
          setBlockConfirm(false)
          void run(() => api.users.block(profile.id), 'ブロックしました')
        }}
      />
      <ReportSheet open={report} onClose={() => setReport(false)} targetType="user" targetId={profile.id} targetLabel="ユーザー" />
    </>
  )
}
