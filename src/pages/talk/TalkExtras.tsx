import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Bell,
  BellOff,
  AtSign,
  Link2,
  LogOut,
  Users,
  Crown,
  Shield,
  UserMinus,
  QrCode as QrIcon,
  Copy,
  Ban,
  Flag,
  Trash2,
  Check,
  Camera,
  Search,
  Pin,
} from 'lucide-react'
import { api, errorMessage, type RoomSummary } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useMe } from '@/app/session'
import { PageHeader } from '@/components/layout/AppLayout'
import { Avatar, Button, Chip, ConfirmDialog, IconButton, Segmented, Sheet, Switch, Tabs, TextField } from '@/components/ui/primitives'
import { EmptyState, FullError } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { QrCode } from '@/components/QrCode'
import { ReportSheet } from '@/components/ReportSheet'
import { Linkified } from '@/components/Linkified'
import { AVATAR_COLORS } from '@/lib/mock/art'
import { formatListTime } from '@/lib/format'
import { HANDLE_PATTERN } from '@/lib/normalize'
import { cn } from '@/lib/cn'
import { RoomAvatar } from './TalkList'

/** U-12 トーク設定：メンバー、写真とリンク、通知、アナウンス、退出 */
export function TalkSettings() {
  const { roomId = '' } = useParams()
  const { data, error, reload } = useLive(() => api.chat.getRoom(roomId), [roomId])
  const media = useLive(() => api.chat.media(roomId), [roomId])
  const me = useMe()
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState<'members' | 'photos' | 'links'>('members')
  const [confirm, setConfirm] = useState<null | 'leave' | 'dissolve' | 'block'>(null)
  const [invite, setInvite] = useState(false)
  const [addMembers, setAddMembers] = useState(false)
  const [rename, setRename] = useState(false)
  const [report, setReport] = useState(false)
  if (error) return <FullError title="トークが見つかりません" onRetry={reload} />
  if (!data) return null
  const { room } = data
  const isAdmin = data.me.role !== 'member'
  const isOwner = data.me.role === 'owner'
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast({ text: ok })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
  return (
    <>
      <PageHeader title="トーク設定" back={`/talk/${roomId}`} actions={<span />} />
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <RoomAvatar s={{ room, peer: data.peer, title: data.title }} size={80} />
          <h1 className="text-title-l">{data.title}</h1>
          {room.kind === 'group' && <p className="text-caption text-fg2">メンバー {room.memberCount}人</p>}
          {room.kind === 'group' && isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => setRename(true)}>
              名前とアイコンを変更
            </Button>
          )}
        </div>

        {/* ZS-CHAT-27 ルーム別通知 */}
        <section className="card p-4">
          <p className="mb-2 text-label">通知</p>
          <Segmented
            label="通知"
            value={data.me.notifyLevel}
            onChange={(v) => run(() => api.chat.updateMembership(roomId, { notifyLevel: v }))}
            options={[
              {
                value: 'all',
                label: (
                  <span className="inline-flex items-center gap-1">
                    <Bell className="size-4" />
                    すべて
                  </span>
                ),
              },
              {
                value: 'mention',
                label: (
                  <span className="inline-flex items-center gap-1">
                    <AtSign className="size-4" />
                    メンションのみ
                  </span>
                ),
              },
              {
                value: 'off',
                label: (
                  <span className="inline-flex items-center gap-1">
                    <BellOff className="size-4" />
                    オフ
                  </span>
                ),
              },
            ]}
          />
          <div className="mt-2">
            <Switch
              label="ピン留め"
              description="トークリストの上部に固定します（最大5件）"
              checked={!!data.me.pinnedAt}
              onChange={(v) => run(() => api.chat.updateMembership(roomId, { pinned: v }))}
            />
          </div>
        </section>

        {data.announcements.length > 0 && (
          <section className="card space-y-2 p-4">
            <p className="text-label">アナウンス</p>
            {data.announcements.map((a) => (
              <div key={a.id} className="flex items-start gap-2 text-body-m">
                <Pin className="mt-1 size-4 shrink-0 text-aurora" />
                <span className="flex-1">{a.body}</span>
                {isAdmin && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => api.chat.pinAnnouncement(roomId, a.id, false))}>
                    解除
                  </Button>
                )}
              </div>
            ))}
          </section>
        )}

        {room.kind === 'group' && isAdmin && data.pendingJoins.length > 0 && (
          <section className="card space-y-2 p-4">
            <p className="text-label">参加の承認待ち</p>
            {data.pendingJoins.map(({ profile }) => (
              <div key={profile.id} className="flex items-center gap-3">
                <Avatar name={profile.displayName} color={profile.avatarColor} url={profile.avatarUrl} size={36} />
                <span className="flex-1 text-body-m">{profile.displayName}</span>
                <Button size="sm" variant="secondary" onClick={() => run(() => api.chat.approveJoin(roomId, profile.id, false))}>
                  拒否
                </Button>
                <Button size="sm" onClick={() => run(() => api.chat.approveJoin(roomId, profile.id, true), '承認しました')}>
                  承認
                </Button>
              </div>
            ))}
          </section>
        )}

        <section>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              ...(room.kind === 'group' ? [{ value: 'members' as const, label: 'メンバー' }] : []),
              { value: 'photos' as const, label: `写真 ${media.data?.images.length ?? ''}` },
              { value: 'links' as const, label: `リンク ${media.data?.links.length ?? ''}` },
            ]}
          />
          <div className="pt-3">
            {tab === 'members' && room.kind === 'group' && (
              <ul className="space-y-1">
                {isAdmin && (
                  <li className="flex gap-2 pb-2">
                    <Button size="sm" variant="secondary" icon={<Users className="size-4" />} onClick={() => setAddMembers(true)}>
                      友だちを招待
                    </Button>
                    <Button size="sm" variant="secondary" icon={<QrIcon className="size-4" />} onClick={() => setInvite(true)}>
                      招待リンク・QR
                    </Button>
                  </li>
                )}
                {data.members.map(({ member, profile }) => (
                  <li key={profile.id} className="flex min-h-14 items-center gap-3">
                    <Avatar name={profile.displayName} color={profile.avatarColor} url={profile.avatarUrl} size={40} />
                    <Link to={`/u/${profile.handle}`} className="min-w-0 flex-1">
                      <span className="block truncate text-body-m">{profile.displayName}</span>
                      <span className="text-caption text-fg2">{member.role === 'owner' ? 'オーナー' : member.role === 'admin' ? '管理者' : 'メンバー'}</span>
                    </Link>
                    {member.role === 'owner' && <Crown className="size-4 text-warning" aria-label="オーナー" />}
                    {isOwner && member.role !== 'owner' && (
                      <IconButton
                        label={member.role === 'admin' ? '管理者を外す' : '管理者にする'}
                        onClick={() => run(() => api.chat.setRole(roomId, profile.id, member.role === 'admin' ? 'member' : 'admin'))}
                      >
                        <Shield className={cn('size-4', member.role === 'admin' && 'fill-current text-brand-text')} />
                      </IconButton>
                    )}
                    {isAdmin && member.role !== 'owner' && profile.id !== me?.id && (
                      <IconButton
                        label="退出させる"
                        className="text-danger"
                        onClick={() => run(() => api.chat.removeMember(roomId, profile.id), '退出させました')}
                      >
                        <UserMinus className="size-4" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(tab === 'photos' || (tab === 'members' && room.kind !== 'group')) &&
              (media.data?.images.length ? (
                <div className="grid grid-cols-3 gap-1">
                  {media.data.images.map((img, i) => (
                    <Link key={i} to={`/talk/${roomId}?m=${img.messageId}`}>
                      <img src={img.thumbUrl} alt="" className="aspect-square w-full rounded-[6px] object-cover" />
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="写真はまだありません" art="planet" />
              ))}
            {tab === 'links' &&
              (media.data?.links.length ? (
                <ul className="space-y-2">
                  {media.data.links.map((l) => (
                    <li key={l.messageId} className="card flex items-center gap-2 p-3 text-body-m">
                      <Link2 className="size-4 shrink-0 text-fg2" />
                      <Linkified text={l.url} className="min-w-0 flex-1 truncate" />
                      <span className="text-caption text-fg2">{formatListTime(l.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="リンクはまだありません" />
              ))}
          </div>
        </section>

        <section className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
          {room.kind !== 'official' && data.peer && (
            <>
              <button
                className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-body-m text-danger hover:bg-surface"
                onClick={() => setConfirm('block')}
              >
                <Ban className="size-5" /> ブロック
              </button>
              <button
                className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-body-m text-danger hover:bg-surface"
                onClick={() => setReport(true)}
              >
                <Flag className="size-5" /> 通報
              </button>
            </>
          )}
          {room.kind !== 'official' && (
            <button
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-body-m text-danger hover:bg-surface"
              onClick={() => setConfirm('leave')}
            >
              <LogOut className="size-5" /> {room.kind === 'group' ? 'グループを退出' : 'トークを削除'}
            </button>
          )}
          {isOwner && room.kind === 'group' && (
            <button
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-body-m text-danger hover:bg-surface"
              onClick={() => setConfirm('dissolve')}
            >
              <Trash2 className="size-5" /> グループを解散
            </button>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirm === 'leave'}
        onClose={() => setConfirm(null)}
        title={room.kind === 'group' ? 'グループを退出しますか？' : 'トークを削除しますか？'}
        body={room.kind === 'group' ? '退出すると、このグループのメッセージは見られなくなります。' : 'トークリストから削除します。相手の画面には残ります。'}
        confirmLabel={room.kind === 'group' ? '退出する' : '削除する'}
        danger
        onConfirm={() => run(async () => (await api.chat.leave(roomId), navigate('/talk')))}
      />
      <ConfirmDialog
        open={confirm === 'dissolve'}
        onClose={() => setConfirm(null)}
        title="グループを解散しますか？"
        body="全員がこのグループから退出し、元に戻せません。"
        confirmLabel="解散する"
        danger
        onConfirm={() => run(async () => (await api.chat.dissolve(roomId), navigate('/talk')))}
      />
      <ConfirmDialog
        open={confirm === 'block'}
        onClose={() => setConfirm(null)}
        title={`${data.title}さんをブロックしますか？`}
        body="相手からのメッセージ、友だち追加、プロフィール閲覧を止めます。相手には通知されません。"
        confirmLabel="ブロックする"
        danger
        onConfirm={() => (setConfirm(null), run(() => api.users.block(data.peer!.id), 'ブロックしました'))}
      />
      {data.peer && <ReportSheet open={report} onClose={() => setReport(false)} targetType="user" targetId={data.peer.id} targetLabel="ユーザー" />}
      <InviteSheet open={invite} onClose={() => setInvite(false)} roomId={roomId} />
      <FriendPicker
        open={addMembers}
        onClose={() => setAddMembers(false)}
        exclude={data.members.map((m) => m.profile.id)}
        confirmLabel="招待する"
        onConfirm={(ids) => run(async () => (await api.chat.inviteMembers(roomId, ids), setAddMembers(false)), '招待しました')}
      />
      <RenameSheet open={rename} onClose={() => setRename(false)} roomId={roomId} name={room.name ?? ''} color={room.iconColor} />
    </>
  )
}

function RenameSheet({ open, onClose, roomId, name, color }: { open: boolean; onClose: () => void; roomId: string; name: string; color: string }) {
  const [n, setN] = useState(name)
  const [c, setC] = useState(color)
  const toast = useToast()
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="名前とアイコン"
      size="sm"
      footer={
        <Button
          block
          onClick={async () => {
            try {
              await api.chat.updateGroup(roomId, { name: n, iconColor: c })
              onClose()
            } catch (e) {
              toast({ text: errorMessage(e), tone: 'error' })
            }
          }}
        >
          保存する
        </Button>
      }
    >
      <div className="space-y-4">
        <TextField label="グループ名" value={n} onChange={(e) => setN(e.target.value)} maxLength={50} />
        <ColorPicker value={c} onChange={setC} />
      </div>
    </Sheet>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-label">アイコンの色</legend>
      <div className="flex flex-wrap gap-2">
        {AVATAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={value === c}
            onClick={() => onChange(c)}
            className="flex size-11 items-center justify-center rounded-full"
            style={{ background: c }}
          >
            {value === c && <Check className="size-5 text-white" />}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** ZS-GRP-02 期限付きの招待リンク・QR コード（24時間、7日、無期限） */
function InviteSheet({ open, onClose, roomId }: { open: boolean; onClose: () => void; roomId: string }) {
  const [ttl, setTtl] = useState<'24h' | '7d' | 'none'>('7d')
  const [approval, setApproval] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const toast = useToast()
  const url = token ? `${location.origin}/invite/${token}` : ''
  return (
    <Sheet open={open} onClose={() => (onClose(), setToken(null))} title="招待リンク" size="sm">
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-label">有効期限</p>
          <Segmented
            label="有効期限"
            value={ttl}
            onChange={setTtl}
            options={[
              { value: '24h', label: '24時間' },
              { value: '7d', label: '7日' },
              { value: 'none', label: '無期限' },
            ]}
          />
        </div>
        <Switch label="参加に管理者の承認を必須にする" checked={approval} onChange={setApproval} />
        <Button
          block
          onClick={async () => {
            try {
              setToken(await api.chat.createInvite(roomId, ttl, approval))
            } catch (e) {
              toast({ text: errorMessage(e), tone: 'error' })
            }
          }}
        >
          リンクを作成
        </Button>
        {token && (
          <div className="flex flex-col items-center gap-3">
            <QrCode value={url} size={200} />
            <div className="flex w-full items-center gap-2 rounded-[12px] bg-surface p-2">
              <span className="min-w-0 flex-1 truncate text-caption">{url}</span>
              <IconButton label="コピー" onClick={async () => (await navigator.clipboard.writeText(url).catch(() => {}), toast({ text: 'コピーしました' }))}>
                <Copy className="size-4" />
              </IconButton>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function FriendPicker({
  open,
  onClose,
  exclude = [],
  confirmLabel,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  exclude?: string[]
  confirmLabel: string
  onConfirm: (ids: string[]) => void
}) {
  const { data } = useLive(() => (open ? api.users.friends() : Promise.resolve([])), [open])
  const [sel, setSel] = useState<string[]>([])
  const [q, setQ] = useState('')
  const list = (data ?? []).filter((p) => !exclude.includes(p.id) && (!q || p.displayName.includes(q) || p.handle.includes(q)))
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="友だちを選ぶ"
      full
      footer={
        <Button block disabled={!sel.length} onClick={() => onConfirm(sel)}>
          {confirmLabel}（{sel.length}人）
        </Button>
      }
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="名前で絞り込む"
        aria-label="名前で絞り込む"
        className="mb-3 min-h-11 w-full rounded-full border border-subtle bg-surface px-4"
      />
      <MemberChecklist list={list} sel={sel} setSel={setSel} />
    </Sheet>
  )
}

function MemberChecklist({
  list,
  sel,
  setSel,
}: {
  list: { id: string; displayName: string; handle: string; avatarColor: string; avatarUrl: string | null }[]
  sel: string[]
  setSel: (fn: (s: string[]) => string[]) => void
}) {
  if (!list.length) return <p className="py-8 text-center text-body-m text-fg2">選べる友だちがいません</p>
  return (
    <ul className="space-y-1">
      {list.map((p) => (
        <li key={p.id}>
          <label className="flex min-h-14 items-center gap-3 rounded-[12px] px-2 hover:bg-surface">
            <input
              type="checkbox"
              checked={sel.includes(p.id)}
              onChange={() => setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
              className="size-5 accent-[var(--brand-primary)]"
            />
            <Avatar name={p.displayName} color={p.avatarColor} url={p.avatarUrl} size={40} />
            <span className="min-w-0">
              <span className="block truncate text-body-m">{p.displayName}</span>
              <span className="block truncate text-caption text-fg2">@{p.handle}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}

/** U-13 グループ作成：メンバー選択、名前とアイコン */
export function GroupCreate() {
  const { data } = useLive(() => api.users.friends(), [])
  const [step, setStep] = useState<0 | 1>(0)
  const [sel, setSel] = useState<string[]>([])
  const [name, setName] = useState('')
  const [color, setColor] = useState(AVATAR_COLORS[1])
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const max = useSync(() => api.app.settings().groupMaxMembers)
  return (
    <>
      <PageHeader title={step === 0 ? 'メンバーを選ぶ' : 'グループを作成'} back={step === 0 ? '/talk' : undefined} actions={<span />} />
      <div className="mx-auto max-w-xl p-4 pb-28">
        {step === 0 ? (
          <>
            <p className="mb-3 text-caption text-fg2">グループは{max}人までです（あとから招待リンクでも追加できます）</p>
            <MemberChecklist list={data ?? []} sel={sel} setSel={setSel} />
          </>
        ) : (
          <div className="space-y-5">
            <div className="flex justify-center">
              <span className="flex size-20 items-center justify-center rounded-[30%] text-white" style={{ background: color }}>
                <Users className="size-9" />
              </span>
            </div>
            <TextField label="グループ名" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required autoFocus />
            <ColorPicker value={color} onChange={setColor} />
            <p className="text-caption text-fg2">メンバー：{sel.length + 1}人（あなたを含む）</p>
          </div>
        )}
      </div>
      <div className="glass fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] border-t border-subtle p-3 lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-xl gap-2">
          {step === 1 && (
            <Button variant="secondary" className="shrink-0" onClick={() => setStep(0)}>
              戻る
            </Button>
          )}
          {step === 0 ? (
            <Button block size="lg" onClick={() => setStep(1)}>
              次へ（{sel.length}人選択中）
            </Button>
          ) : (
            <Button
              block
              size="lg"
              loading={busy}
              disabled={!name.trim()}
              onClick={async () => {
                setBusy(true)
                try {
                  const id = await api.chat.createGroup(name, sel, color)
                  navigate(`/talk/${id}`, { replace: true })
                } catch (e) {
                  toast({ text: errorMessage(e), tone: 'error' })
                } finally {
                  setBusy(false)
                }
              }}
            >
              作成する
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

/** U-14 友だち追加：ID検索、QRコードの読み取りと表示、招待リンク */
export function AddFriend() {
  const me = useMe()!
  const [tab, setTab] = useState<'id' | 'qr' | 'suggest'>('id')
  const [handle, setHandle] = useState('')
  const [result, setResult] = useState<'idle' | 'none' | Awaited<ReturnType<typeof api.users.getProfileByHandle>>>('idle')
  const suggest = useLive(() => api.users.suggestions(), [])
  const addedMe = useLive(() => api.users.addedMe(), [])
  const toast = useToast()
  const navigate = useNavigate()
  const myUrl = `${location.origin}/u/${me.handle}`
  const add = async (id: string) => {
    try {
      await api.users.addFriend(id)
      toast({ text: '友だちに追加しました', tone: 'success' })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
  return (
    <>
      <PageHeader title="友だち追加" back="/talk" actions={<span />}>
        <Tabs
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'id', label: 'ID検索' },
            { value: 'qr', label: 'QRコード' },
            { value: 'suggest', label: '知り合いかも' },
          ]}
        />
      </PageHeader>
      <div className="mx-auto max-w-xl space-y-6 p-4">
        {tab === 'id' && (
          <>
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                const h = handle.replace(/^@/, '')
                if (!HANDLE_PATTERN.test(h)) return setResult('none')
                const p = await api.users.getProfileByHandle(h)
                setResult(p ?? 'none')
              }}
            >
              <div className="relative flex-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg2">@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="ユーザーID"
                  aria-label="ユーザーID"
                  autoCapitalize="off"
                  className="min-h-11 w-full rounded-[12px] border border-subtle bg-surface pl-8 pr-3"
                />
              </div>
              <Button type="submit" icon={<Search className="size-4" />}>
                検索
              </Button>
            </form>
            {result === 'none' && <p className="text-center text-body-m text-fg2">ユーザーが見つかりません</p>}
            {result && typeof result === 'object' && <PersonRow p={result} onAdd={() => add(result.id)} />}
            {(addedMe.data?.length ?? 0) > 0 && (
              <section className="space-y-2">
                <h2 className="text-label">あなたを追加したユーザー</h2>
                {addedMe.data!.map((p) => (
                  <PersonRow key={p.id} p={p} onAdd={() => add(p.id)} />
                ))}
              </section>
            )}
          </>
        )}
        {tab === 'qr' && (
          <div className="flex flex-col items-center gap-4">
            <div className="card flex flex-col items-center gap-3 p-6">
              <QrCode value={myUrl} size={200} />
              <p className="text-body-m font-bold">@{me.handle}</p>
              <p className="text-caption text-fg2">このQRコードを相手に読み取ってもらいます</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                icon={<Copy className="size-4" />}
                onClick={async () => (await navigator.clipboard.writeText(myUrl).catch(() => {}), toast({ text: '招待リンクをコピーしました' }))}
              >
                招待リンクをコピー
              </Button>
              <QrScanButton
                onResult={(text) => {
                  const m = text.match(/\/u\/([A-Za-z0-9_]+)/)
                  if (m) navigate(`/u/${m[1]}`)
                  else toast({ text: 'zenospace のQRコードではありません', tone: 'error' })
                }}
              />
            </div>
          </div>
        )}
        {tab === 'suggest' && (
          <section className="space-y-2">
            {suggest.data?.length ? (
              suggest.data.map((p) => <PersonRow key={p.id} p={p} onAdd={() => add(p.id)} />)
            ) : (
              <EmptyState title="候補はいません" body="共通のグループのメンバーや、あなたを追加した人が表示されます" />
            )}
          </section>
        )}
      </div>
    </>
  )
}

function PersonRow({ p, onAdd }: { p: NonNullable<Awaited<ReturnType<typeof api.users.getProfileByHandle>>>; onAdd: () => void }) {
  const rel = useSync(() => api.users.relation(p.id))
  return (
    <div className="card flex items-center gap-3 p-3">
      <Avatar name={p.displayName} color={p.avatarColor} url={p.avatarUrl} size={44} />
      <Link to={`/u/${p.handle}`} className="min-w-0 flex-1">
        <span className="block truncate text-body-m font-bold">{p.displayName}</span>
        <span className="block truncate text-caption text-fg2">@{p.handle}</span>
      </Link>
      {rel.friend ? (
        <Chip selected>
          <Check className="size-3.5" />
          友だち
        </Chip>
      ) : (
        <Button size="sm" onClick={onAdd}>
          追加
        </Button>
      )}
    </div>
  )
}

/** QR コードの読み取り（BarcodeDetector 対応端末のみ。非対応は案内を出す） */
function QrScanButton({ onResult }: { onResult: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let raf = 0
    const Detector = (
      window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }
    ).BarcodeDetector
    if (!Detector) {
      setErr('この端末のブラウザはQRコードの読み取りに対応していません。端末のカメラアプリで読み取ってください')
      return
    }
    const det = new Detector({ formats: ['qr_code'] })
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        if (video.current) {
          video.current.srcObject = s
          void video.current.play()
        }
        const tick = async () => {
          if (video.current && video.current.readyState >= 2) {
            const codes = await det.detect(video.current).catch(() => [])
            if (codes[0]) {
              setOpen(false)
              onResult(codes[0].rawValue)
              return
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(() => setErr('カメラを使えませんでした。ブラウザの設定でカメラを許可してください'))
    return () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open, onResult])
  return (
    <>
      <Button icon={<Camera className="size-4" />} onClick={() => (setErr(null), setOpen(true))}>
        読み取る
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="QRコードを読み取る" size="sm">
        {err ? (
          <p className="py-6 text-body-m text-fg2">{err}</p>
        ) : (
          <video ref={video} className="aspect-square w-full rounded-[12px] bg-black object-cover" playsInline muted />
        )}
      </Sheet>
    </>
  )
}

/** U-15 メッセージリクエスト：一覧、承認、削除、ブロック、通報 */
export function Requests() {
  const { data } = useLive(() => api.chat.listRequests(), [])
  const [open, setOpen] = useState<RoomSummary | null>(null)
  return (
    <>
      <PageHeader title="メッセージリクエスト" back="/talk" actions={<span />} />
      <div className="mx-auto max-w-xl p-4">
        <p className="mb-3 text-caption text-fg2">友だちでない相手からの最初のメッセージです。承認するまで、相手に既読は付かず、通知も届きません。</p>
        {data?.length === 0 && <EmptyState art="chat" title="リクエストはありません" />}
        <ul className="space-y-2">
          {data?.map((s) => (
            <li key={s.room.id}>
              <button onClick={() => setOpen(s)} className="card flex w-full items-center gap-3 p-3 text-left">
                <RoomAvatar s={s} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-m font-bold">{s.title}</span>
                  <span className="block truncate text-caption text-fg2">{s.lastMessagePreview}</span>
                </span>
                <span className="text-caption text-fg2">{formatListTime(s.lastMessageAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {open && <RequestSheet s={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function RequestSheet({ s, onClose }: { s: RoomSummary; onClose: () => void }) {
  const { data } = useLive(() => api.chat.previewRequest(s.room.id), [s.room.id])
  const [report, setReport] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const run = async (fn: () => Promise<unknown>, text: string) => {
    try {
      await fn()
      toast({ text })
      onClose()
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={s.title}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            icon={<Trash2 className="size-4" />}
            onClick={() => run(() => api.chat.deleteRequest(s.room.id), 'リクエストを削除しました')}
          >
            削除
          </Button>
          <Button
            onClick={async () => {
              await api.chat.acceptRequest(s.room.id)
              onClose()
              navigate(`/talk/${s.room.id}`)
            }}
          >
            承認してトーク
          </Button>
          <Button
            variant="ghost"
            className="text-danger"
            icon={<Ban className="size-4" />}
            onClick={() => run(async () => (s.peer && (await api.users.block(s.peer.id)), await api.chat.deleteRequest(s.room.id)), 'ブロックしました')}
          >
            ブロック
          </Button>
          <Button variant="ghost" className="text-danger" icon={<Flag className="size-4" />} onClick={() => setReport(true)}>
            通報
          </Button>
        </div>
      }
    >
      {s.peer && (
        <Link to={`/u/${s.peer.handle}`} className="mb-3 flex items-center gap-3">
          <Avatar name={s.peer.displayName} color={s.peer.avatarColor} url={s.peer.avatarUrl} size={40} />
          <span className="text-caption text-fg2">@{s.peer.handle}・プロフィールを見る</span>
        </Link>
      )}
      <div className="space-y-2">
        {data?.map((m) => (
          <div key={m.id} className="rounded-[18px] bg-bubble-other px-3.5 py-2 text-body-l whitespace-pre-wrap">
            {m.kind === 'work' ? '作品を共有しました' : m.body}
          </div>
        ))}
      </div>
      {s.peer && <ReportSheet open={report} onClose={() => setReport(false)} targetType="user" targetId={s.peer.id} targetLabel="ユーザー" />}
    </Sheet>
  )
}

/** グループ招待リンクを開いたとき */
export function InviteLanding() {
  const { token = '' } = useParams()
  const { data, loading } = useLive(() => api.chat.inviteInfo(token), [token])
  const navigate = useNavigate()
  const toast = useToast()
  if (loading) return null
  if (!data || data.expired) return <FullError title="招待リンクの有効期限が切れています" body="招待した人に新しいリンクを発行してもらってください" />
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-20 items-center justify-center rounded-[30%] text-white" style={{ background: data.room.iconColor }}>
        <Users className="size-9" />
      </span>
      <h1 className="text-title-l">{data.room.name}</h1>
      <p className="text-body-m text-fg2">
        メンバー {data.room.memberCount}人{data.requiresApproval && '・参加には管理者の承認が必要です'}
      </p>
      <Button
        size="lg"
        onClick={async () => {
          try {
            const r = await api.chat.joinByInvite(token)
            if (r.pending) toast({ text: '参加を申請しました。管理者の承認をお待ちください' })
            else navigate(`/talk/${r.roomId}`, { replace: true })
          } catch (e) {
            toast({ text: errorMessage(e), tone: 'error' })
          }
        }}
      >
        グループに参加する
      </Button>
    </div>
  )
}
