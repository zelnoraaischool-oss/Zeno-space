import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, User, UserCog, Lock, Bell, Palette, HelpCircle, LogOut, Download, ShieldAlert, Camera, RotateCcw, Ticket } from 'lucide-react'
import { api, dataSource, errorMessage } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useMe } from '@/app/session'
import { PageHeader } from '@/components/layout/AppLayout'
import { Avatar, Button, Chip, ConfirmDialog, Segmented, Select, Switch, TextArea, TextField } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { ImageCropper, type CropRect } from '@/components/ImageCropper'
import { COMMISSION, INTEREST_TAGS, LIMITS, NOTIFICATION_TYPES, PREFECTURES } from '@/lib/constants'
import { resetDb } from '@/lib/mock/db'
import { requestPushPermission } from '@/lib/pwa'
import type { CommissionStatus, DmPolicy, UserSettings } from '@/lib/types'

const SECTIONS = [
  { key: 'profile', label: 'プロフィール', icon: User },
  { key: 'account', label: 'アカウント', icon: UserCog },
  { key: 'privacy', label: 'プライバシー', icon: Lock },
  { key: 'notifications', label: '通知', icon: Bell },
  { key: 'display', label: '表示', icon: Palette },
  { key: 'help', label: 'ヘルプ・規約', icon: HelpCircle },
] as const

/** U-21 設定（8.4） */
export default function Settings() {
  const { section } = useParams()
  const me = useMe()
  const restrictions = useSync(() => api.users.myRestrictions())
  const navigate = useNavigate()
  const [logout, setLogout] = useState(false)
  if (!me) return <Navigate to="/login" replace />
  if (section) {
    const s = SECTIONS.find((x) => x.key === section)
    return (
      <>
        <PageHeader title={s?.label ?? '設定'} back="/settings" actions={<span />} />
        <div className="mx-auto max-w-2xl p-4 pb-10">
          {section === 'profile' && <ProfileSettings />}
          {section === 'account' && <AccountSettings />}
          {section === 'privacy' && <PrivacySettings />}
          {section === 'notifications' && <NotificationSettings />}
          {section === 'display' && <DisplaySettings />}
          {section === 'help' && <Help />}
        </div>
      </>
    )
  }
  return (
    <>
      <PageHeader title="設定" actions={<span />} />
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <Link to="/me" className="card flex items-center gap-3 p-4">
          <Avatar name={me.displayName} color={me.avatarColor} url={me.avatarUrl} size={48} />
          <span>
            <span className="block text-body-m font-bold">{me.displayName}</span>
            <span className="text-caption text-fg2">@{me.handle}</span>
          </span>
        </Link>
        {restrictions.length > 0 && (
          <Link to="/restricted" className="card flex min-h-12 items-center gap-3 border-warning/40 px-4 text-body-m">
            <ShieldAlert className="size-5 text-warning" /> <span className="flex-1">利用制限</span> <ChevronRight className="size-4 text-fg2" />
          </Link>
        )}
        <nav className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
          {SECTIONS.map((s) => (
            <Link key={s.key} to={`/settings/${s.key}`} className="flex min-h-12 items-center gap-3 px-4 text-body-m hover:bg-surface">
              <s.icon className="size-5 text-fg2" strokeWidth={1.75} />
              <span className="flex-1">{s.label}</span>
              <ChevronRight className="size-4 text-fg2" />
            </Link>
          ))}
        </nav>
        <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
          <button className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-body-m hover:bg-surface" onClick={() => setLogout(true)}>
            <LogOut className="size-5 text-fg2" /> ログアウト
          </button>
        </div>
        {dataSource === 'mock' && (
          <button
            className="flex min-h-11 w-full items-center justify-center gap-2 text-caption text-fg2"
            onClick={() => {
              if (confirm('デモデータを初期状態に戻しますか？（この端末のモックDBが消えます）')) {
                resetDb()
                navigate('/')
              }
            }}
          >
            <RotateCcw className="size-3.5" /> デモデータを初期化（モック動作中のみ）
          </button>
        )}
      </div>
      <ConfirmDialog
        open={logout}
        onClose={() => setLogout(false)}
        title="ログアウトしますか？"
        confirmLabel="ログアウトする"
        onConfirm={async () => {
          await api.auth.signOut()
          navigate('/', { replace: true })
        }}
      />
    </>
  )
}

function ProfileSettings() {
  const me = useMe()!
  const toast = useToast()
  const [form, setForm] = useState({
    displayName: me.displayName,
    bio: me.bio,
    skills: me.skills,
    links: me.links.join('\n'),
    prefecture: me.prefecture ?? '',
    commissionStatus: me.commissionStatus,
    interests: me.interests,
  })
  const [skill, setSkill] = useState('')
  const [busy, setBusy] = useState(false)
  const [crop, setCrop] = useState<{ file: File; kind: 'avatar' | 'cover' } | null>(null)
  const avatarRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const upload = async (file: File, kind: 'avatar' | 'cover', c: CropRect) => {
    try {
      const up = await api.storage.uploadImage(file, { kind, crop: c })
      await api.users.updateProfile(kind === 'avatar' ? { avatarUrl: up.url } : { coverUrl: up.url })
      toast({ text: '画像を更新しました', tone: 'success' })
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await api.users.updateProfile({
            displayName: form.displayName,
            bio: form.bio,
            skills: form.skills,
            links: form.links
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean),
            prefecture: form.prefecture || null,
            commissionStatus: form.commissionStatus,
            interests: form.interests,
          })
          toast({ text: 'プロフィールを保存しました', tone: 'success' })
        } catch (err) {
          toast({ text: errorMessage(err), tone: 'error' })
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => coverRef.current?.click()}
          className="relative block h-28 w-full overflow-hidden rounded-[16px]"
          style={{ background: `linear-gradient(135deg, ${me.avatarColor}, #22D3EE)` }}
          aria-label="カバー画像を変更"
        >
          {me.coverUrl && <img src={me.coverUrl} alt="" className="size-full object-cover" />}
          <span className="absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white">
            <Camera className="size-4" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => avatarRef.current?.click()}
          className="absolute -bottom-8 left-4 rounded-full ring-4 ring-[var(--bg-base)]"
          aria-label="アイコンを変更"
        >
          <Avatar name={me.displayName} color={me.avatarColor} url={me.avatarUrl} size={72} />
        </button>
      </div>
      <input
        ref={avatarRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => (e.target.files?.[0] && setCrop({ file: e.target.files[0], kind: 'avatar' }), (e.target.value = ''))}
      />
      <input
        ref={coverRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => (e.target.files?.[0] && setCrop({ file: e.target.files[0], kind: 'cover' }), (e.target.value = ''))}
      />
      <div className="pt-6" />
      <TextField
        label="表示名"
        value={form.displayName}
        maxLength={LIMITS.displayName}
        counter={{ value: form.displayName.length, max: LIMITS.displayName }}
        onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        required
      />
      <TextArea
        label="自己紹介"
        value={form.bio}
        maxLength={LIMITS.bio}
        counter={{ value: form.bio.length, max: LIMITS.bio }}
        onChange={(e) => setForm({ ...form, bio: e.target.value })}
      />
      {/* ZS-PROF-02 制作依頼ステータス */}
      <fieldset>
        <legend className="mb-2 text-label">制作依頼の受付</legend>
        <Segmented
          label="制作依頼の受付"
          value={form.commissionStatus}
          onChange={(v) => setForm({ ...form, commissionStatus: v as CommissionStatus })}
          options={(Object.keys(COMMISSION) as CommissionStatus[]).map((k) => ({ value: k, label: COMMISSION[k].label }))}
        />
        <p className="mt-1 text-caption text-fg2">「停止中」にすると、作品の問い合わせボタンが無効になります</p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-label">
          スキルタグ{' '}
          <span className="text-caption text-fg2 tabular">
            {form.skills.length}/{LIMITS.skills}
          </span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {form.skills.map((s) => (
            <Chip key={s} selected onClick={() => setForm({ ...form, skills: form.skills.filter((x) => x !== s) })}>
              {s} ×
            </Chip>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (skill.trim() && form.skills.length < LIMITS.skills && !form.skills.includes(skill.trim()))
                  setForm({ ...form, skills: [...form.skills, skill.trim()] })
                setSkill('')
              }
            }}
            placeholder="スキルを入力してEnter"
            aria-label="スキルを追加"
            className="min-h-11 flex-1 rounded-[12px] border border-subtle bg-surface px-3"
          />
        </div>
      </fieldset>
      <TextArea
        label={`外部リンク（1行に1つ・最大${LIMITS.links}つ）`}
        value={form.links}
        onChange={(e) => setForm({ ...form, links: e.target.value })}
        rows={3}
        placeholder="https://"
      />
      <Select
        label="活動地域（任意）"
        value={form.prefecture}
        onChange={(v) => setForm({ ...form, prefecture: v })}
        options={[{ value: '', label: '指定しない' }, ...PREFECTURES.map((p) => ({ value: p, label: p }))]}
      />
      <fieldset id="interests">
        <legend className="mb-2 text-label">興味タグ（おすすめに使います）</legend>
        <div className="flex flex-wrap gap-2">
          {INTEREST_TAGS.map((t) => (
            <Chip
              key={t}
              selected={form.interests.includes(t)}
              onClick={() => setForm({ ...form, interests: form.interests.includes(t) ? form.interests.filter((x) => x !== t) : [...form.interests, t] })}
            >
              {t}
            </Chip>
          ))}
        </div>
      </fieldset>
      <Button type="submit" block size="lg" loading={busy}>
        保存する
      </Button>
      <ImageCropper
        file={crop?.file ?? null}
        aspect={crop?.kind === 'cover' ? 3 : 1}
        round={crop?.kind === 'avatar'}
        title={crop?.kind === 'cover' ? 'カバー画像を切り抜く' : 'アイコンを切り抜く'}
        onCancel={() => setCrop(null)}
        onDone={(c) => (crop && void upload(crop.file, crop.kind, c), setCrop(null))}
      />
    </form>
  )
}

function AccountSettings() {
  const me = useMe()!
  const toast = useToast()
  const navigate = useNavigate()
  const [handle, setHandle] = useState(me.handle)
  const [leave, setLeave] = useState(false)
  const linked = useSync(() => api.auth.linkedIdentities())
  const inviteOnly = useSync(() => api.app.settings().inviteOnly)
  const [code, setCode] = useState<string | null>(null)
  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-4">
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api.auth.changeHandle(handle)
              toast({ text: 'ユーザーIDを変更しました', tone: 'success' })
            } catch (err) {
              toast({ text: errorMessage(err), tone: 'error' })
            }
          }}
        >
          <TextField
            label="ユーザーID"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            hint="英数字と _ の4〜20文字。変更は30日に1回までです"
            autoCapitalize="off"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={handle === me.handle}>
            変更する
          </Button>
        </form>
      </section>
      <section className="card space-y-2 p-4">
        <p className="text-label">ログイン手段の連携（ZS-AUTH-03）</p>
        {(['google', 'github', 'email'] as const).map((k) => (
          <div key={k} className="flex min-h-11 items-center justify-between text-body-m">
            <span>{{ google: 'Google', github: 'GitHub', email: 'メール（ワンタイムコード）' }[k]}</span>
            {linked.includes(k) ? (
              <span className="text-caption text-success">連携済み</span>
            ) : k === 'email' ? (
              <span className="text-caption text-fg2">未設定</span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const email = prompt(`${k === 'google' ? 'Google' : 'GitHub'} のメールアドレス（モック）`)
                  if (!email) return
                  try {
                    await api.auth.linkProvider(k, email)
                    toast({ text: '連携しました', tone: 'success' })
                  } catch (e) {
                    toast({ text: errorMessage(e), tone: 'error' })
                  }
                }}
              >
                連携する
              </Button>
            )}
          </div>
        ))}
        <p className="text-caption text-fg2">1人1アカウントのため、連携済みのメールアドレスで新しいアカウントは作れません。</p>
      </section>
      {inviteOnly && (
        <section className="card space-y-2 p-4">
          <p className="text-label">招待コード</p>
          <p className="text-caption text-fg2">現在は招待制です。招待コードは1回だけ使え、14日で失効します。</p>
          {code ? (
            <p className="text-title-m tracking-widest tabular">{code}</p>
          ) : (
            <Button size="sm" variant="secondary" icon={<Ticket className="size-4" />} onClick={async () => setCode(await api.auth.issueInviteCode())}>
              発行する
            </Button>
          )}
        </section>
      )}
      <section className="card space-y-2 p-4">
        <p className="text-label">データの書き出し（ZS-SET-05）</p>
        <Button
          size="sm"
          variant="secondary"
          icon={<Download className="size-4" />}
          onClick={async () => {
            const works = await api.works.mine()
            const blob = new Blob([JSON.stringify({ profile: me, works }, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `zenospace-${me.handle}.json`
            a.click()
          }}
        >
          JSON で書き出す
        </Button>
      </section>
      <section className="space-y-2">
        <Button variant="ghost" className="text-danger" onClick={() => setLeave(true)}>
          退会する
        </Button>
      </section>
      <ConfirmDialog
        open={leave}
        onClose={() => setLeave(false)}
        title="退会しますか？"
        body="退会すると30日後にアカウントが削除され、元に戻せなくなります。30日以内にログインすると復元できます。投稿とメッセージは「退会したユーザー」として残ります。"
        confirmLabel="退会する"
        danger
        requireText="退会する"
        onConfirm={async () => {
          await api.auth.requestDeletion()
          navigate('/', { replace: true })
        }}
      />
    </div>
  )
}

function PrivacySettings() {
  const me = useMe()!
  const blocked = useLive(() => api.users.blockedUsers(), [])
  const toast = useToast()
  const save = async (patch: Parameters<typeof api.users.updateProfile>[0]) => {
    try {
      await api.users.updateProfile(patch)
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }
  return (
    <div className="space-y-6">
      {/* ZS-SOC-02 メッセージ受信設定 */}
      <section className="card space-y-2 p-4">
        <p className="text-label">メッセージを受け取る相手</p>
        {(
          [
            ['everyone', '全員（リクエスト経由）', '友だち以外からの最初のメッセージはリクエストに入ります'],
            ['friends', '友だちのみ', 'あなたが追加した相手だけがメッセージを送れます'],
            ['inquiry', '作品の問い合わせのみ', '作品詳細からの問い合わせだけを受け付けます'],
          ] as [DmPolicy, string, string][]
        ).map(([v, l, d]) => (
          <label key={v} className="flex min-h-12 items-start gap-3 py-1">
            <input
              type="radio"
              name="dm"
              checked={me.dmPolicy === v}
              onChange={() => save({ dmPolicy: v })}
              className="mt-1 size-5 accent-[var(--brand-primary)]"
            />
            <span>
              <span className="block text-body-m">{l}</span>
              <span className="block text-caption text-fg2">{d}</span>
            </span>
          </label>
        ))}
      </section>
      <section className="card p-4">
        <p className="mb-2 text-label">プロフィールの公開範囲</p>
        <Segmented
          label="公開範囲"
          value={me.profileVisibility}
          onChange={(v) => save({ profileVisibility: v })}
          options={[
            { value: 'public', label: '全体' },
            { value: 'members', label: 'ログインユーザーのみ' },
          ]}
        />
      </section>
      <section className="card space-y-2 p-4">
        <p className="text-label">ブロックリスト</p>
        {blocked.data?.length === 0 && <p className="text-body-m text-fg2">ブロックしているユーザーはいません</p>}
        {blocked.data?.map((p) => (
          <div key={p.id} className="flex min-h-12 items-center gap-3">
            <Avatar name={p.displayName} color={p.avatarColor} url={p.avatarUrl} size={36} />
            <span className="flex-1 text-body-m">{p.displayName}</span>
            <Button size="sm" variant="secondary" onClick={() => api.users.unblock(p.id)}>
              解除
            </Button>
          </div>
        ))}
      </section>
    </div>
  )
}

function NotificationSettings() {
  const s = useSync(() => api.users.settings())!
  const toast = useToast()
  const update = (patch: Partial<UserSettings>) => api.users.updateSettings(patch).catch((e) => toast({ text: errorMessage(e), tone: 'error' }))
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  return (
    <div className="space-y-6">
      <section className="card space-y-2 p-4">
        <p className="text-label">Web Push</p>
        <p className="text-body-m text-fg2">
          {perm === 'granted'
            ? 'この端末で通知を受け取れます。'
            : perm === 'denied'
              ? 'ブラウザの設定で通知がブロックされています。'
              : perm === 'unsupported'
                ? 'この環境は通知に対応していません。iPhone はホーム画面に追加したアプリでのみ通知が届きます。'
                : '通知はまだ許可されていません。'}
        </p>
        {perm === 'default' && (
          <Button
            size="sm"
            onClick={async () => {
              const sub = await requestPushPermission()
              await api.notifications.savePushSubscription(sub)
            }}
          >
            通知を許可する
          </Button>
        )}
      </section>
      <section className="card p-4">
        <p className="mb-1 text-label">通知の種類</p>
        {NOTIFICATION_TYPES.map((t) => (
          <Switch
            key={t.kind}
            label={t.label}
            description={t.locked ? 'オフにできません' : t.push ? undefined : 'アプリ内のみ'}
            checked={s.notify[t.kind]}
            disabled={t.locked}
            onChange={(v) => update({ notify: { ...s.notify, [t.kind]: v } })}
          />
        ))}
      </section>
      <section className="card space-y-2 p-4">
        <Switch
          label="おやすみモード"
          description="指定した時間帯は Push を鳴らさず、通知センターにだけ入れます"
          checked={s.quietHours.enabled}
          onChange={(v) => update({ quietHours: { ...s.quietHours, enabled: v } })}
        />
        {s.quietHours.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              type="time"
              label="開始"
              value={s.quietHours.start}
              onChange={(e) => update({ quietHours: { ...s.quietHours, start: e.target.value } })}
            />
            <TextField type="time" label="終了" value={s.quietHours.end} onChange={(e) => update({ quietHours: { ...s.quietHours, end: e.target.value } })} />
          </div>
        )}
        <Switch label="Push にメッセージ本文を出さない" checked={s.hidePushBody} onChange={(v) => update({ hidePushBody: v })} />
      </section>
    </div>
  )
}

function DisplaySettings() {
  const s = useSync(() => api.users.settings())!
  const update = (patch: Partial<UserSettings>) => void api.users.updateSettings(patch)
  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-4">
        <p className="text-label">テーマ</p>
        <Segmented
          label="テーマ"
          value={s.theme}
          onChange={(v) => update({ theme: v })}
          options={[
            { value: 'system', label: '端末に合わせる' },
            { value: 'light', label: 'ライト' },
            { value: 'dark', label: 'ダーク' },
          ]}
        />
        <p className="text-label">文字サイズ</p>
        <Segmented
          label="文字サイズ"
          value={s.textSize}
          onChange={(v) => update({ textSize: v })}
          options={[
            { value: 'normal', label: '標準' },
            { value: 'large', label: '大' },
            { value: 'xlarge', label: '特大' },
          ]}
        />
        <Switch label="アニメーションを減らす" checked={s.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
      </section>
      <section className="card p-4">
        <Switch
          label="PC で Enter キーを送信にする"
          description="オフにすると Enter で改行、Shift+Enter で送信します"
          checked={s.enterToSend}
          onChange={(v) => update({ enterToSend: v })}
        />
      </section>
    </div>
  )
}

const FAQ = [
  [
    'アカウントを複数作れますか？',
    'zenospace は1人1アカウントでご利用いただいています。Google・GitHub・メールの複数のログイン手段を1つのアカウントに連携できます。',
  ],
  ['iPhone で通知が届きません', 'iPhone では、Safari の共有メニューから「ホーム画面に追加」したアプリでのみ通知が届きます（iOS 16.4 以上）。'],
  ['作品を非公開にしたい', 'マイページ ＞ 自分の作品を管理 から、非公開・削除ができます。削除した作品は30日間ゴミ箱に残ります。'],
  ['知らない人からのメッセージを止めたい', '設定 ＞ プライバシー で、メッセージを受け取る相手を「友だちのみ」にできます。'],
]

function Help() {
  const navigate = useNavigate()
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-label">よくある質問</h2>
        {FAQ.map(([q, a]) => (
          <details key={q} className="card p-4">
            <summary className="min-h-6 cursor-pointer text-body-m font-bold">{q}</summary>
            <p className="mt-2 text-body-m text-fg2">{a}</p>
          </details>
        ))}
      </section>
      {/* 3.2.6 一貫したヘルプ：設定と公式アカウントの同じ位置に問い合わせ導線 */}
      <Button block onClick={() => navigate(`/talk/${api.chat.officialRoomId()}`)}>
        運営に問い合わせる（公式アカウント）
      </Button>
      <nav className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
        {[
          ['/legal/terms', '利用規約'],
          ['/legal/privacy', 'プライバシーポリシー'],
          ['/legal/external', '外部送信について'],
          ['/legal/guidelines', 'コミュニティガイドライン'],
          ['/legal/takedown', '削除の申出・著作権侵害の申出'],
        ].map(([to, l]) => (
          <Link key={to} to={to} className="flex min-h-12 items-center justify-between px-4 text-body-m hover:bg-surface">
            {l} <ChevronRight className="size-4 text-fg2" />
          </Link>
        ))}
      </nav>
      <p className="text-center text-caption text-fg2">zenospace v0.1.0</p>
    </div>
  )
}
