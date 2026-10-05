import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Type,
  Image as ImageIcon,
  CreditCard,
  GalleryHorizontal,
  LayoutGrid,
  Send,
  FlaskConical,
  Save,
  Undo2,
} from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { Avatar, Badge, Button, Chip, ConfirmDialog, IconButton, Segmented, Switch, Tabs, TextArea, TextField } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { formatDateTime, formatNumber } from '@/lib/format'
import { COMMISSION, INTEREST_TAGS, LIMITS } from '@/lib/constants'
import type { Broadcast, BroadcastStatus, Bubble, CommissionStatus, RichCard, SegmentQuery } from '@/lib/types'
import { cn } from '@/lib/cn'
import { useAdminRole } from './AdminLayout'
import { can } from '@/lib/api/shared'
import { useSync } from '@/hooks/useLive'

const STATUS: Record<BroadcastStatus, { label: string; tone: 'muted' | 'warning' | 'aurora' | 'success' | 'danger' }> = {
  draft: { label: '下書き', tone: 'muted' },
  pending: { label: '承認待ち', tone: 'warning' },
  scheduled: { label: '予約', tone: 'aurora' },
  sent: { label: '送信済み', tone: 'success' },
  canceled: { label: '取り消し', tone: 'danger' },
}

/** A-07 配信一覧：予約、送信済み、下書き、承認待ち */
export function BroadcastList() {
  const { data } = useLive(() => api.admin.broadcasts(), [])
  const [tab, setTab] = useState<BroadcastStatus | 'all'>('all')
  const list = (data ?? []).filter((b) => tab === 'all' || b.status === tab)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-title-l">一斉配信</h1>
        <Link to="/admin/broadcasts/new">
          <Button icon={<Plus className="size-4" />}>配信を作成</Button>
        </Link>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'すべて' },
          { value: 'scheduled', label: '予約' },
          { value: 'sent', label: '送信済み' },
          { value: 'draft', label: '下書き' },
          { value: 'pending', label: '承認待ち' },
        ]}
      />
      <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
        {list.length === 0 && <p className="p-6 text-center text-fg2">配信はありません</p>}
        {list.map((b) => (
          <Link
            key={b.id}
            to={b.status === 'sent' ? `/admin/broadcasts/${b.id}/report` : `/admin/broadcasts/${b.id}`}
            className="flex items-center gap-3 p-4 hover:bg-surface"
          >
            <Badge tone={b.canceledAt ? 'danger' : STATUS[b.status].tone}>{b.canceledAt ? '取り消し' : STATUS[b.status].label}</Badge>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-m font-bold">{b.title || '無題'}</span>
              <span className="text-caption text-fg2">
                {b.audience === 'all' ? '全員' : b.audience === 'segment' ? 'セグメント' : 'テスト'}・{formatNumber(b.targetCount)}人
              </span>
            </span>
            <span className="text-caption text-fg2 tabular">
              {b.sentAt ? formatDateTime(b.sentAt) : b.scheduledAt ? `${formatDateTime(b.scheduledAt)} 予約` : formatDateTime(b.createdAt)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

const emptyCard = (): RichCard => ({ title: '', body: '', buttons: [] })

/** A-08 配信作成（14.10）：左で組み立て、中央で宛先と日時、右のスマホプレビューで確かめてから送る */
export function BroadcastCompose() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const { data: existing } = useLive(() => (isNew ? Promise.resolve(null) : api.admin.broadcast(id!)), [id])
  const navigate = useNavigate()
  const toast = useToast()
  const role = useAdminRole()
  const approvalOn = useSync(() => api.admin.settings().broadcastApprovalRequired)
  const [b, setB] = useState<Partial<Broadcast>>({
    title: '',
    audience: 'all',
    segmentQuery: null,
    bubbles: [{ type: 'text', text: '' }],
    pushText: '',
    scheduledAt: null,
  })
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [previewTheme, setPreviewTheme] = useState<'dark' | 'light'>('dark')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (existing) {
      setB(existing)
      setWhen(existing.scheduledAt ? 'later' : 'now')
    }
  }, [existing])
  const { data: count = 0 } = useLive(
    () => api.admin.estimateAudience(b.audience ?? 'all', b.segmentQuery ?? null),
    [b.audience, JSON.stringify(b.segmentQuery)],
  )
  const bubbles = b.bubbles ?? []
  const setBubbles = (bs: Bubble[]) => setB({ ...b, bubbles: bs })
  const setSeg = (patch: Partial<SegmentQuery>) => setB({ ...b, segmentQuery: { ...(b.segmentQuery ?? {}), ...patch } })
  const canApprove = can(role, 'broadcastApprove')
  const onlyRequest = approvalOn && !canApprove

  const save = async (): Promise<Broadcast | null> => {
    try {
      const saved = await api.admin.saveBroadcast({ ...b, id: isNew ? b.id : id, scheduledAt: when === 'later' ? b.scheduledAt : null })
      setB(saved)
      if (isNew) navigate(`/admin/broadcasts/${saved.id}`, { replace: true })
      return saved
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'error' })
      return null
    }
  }
  const act = async (fn: (id: string) => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true)
    const saved = await save()
    if (saved)
      try {
        await fn(saved.id)
        toast({ text: ok, tone: 'success' })
        after?.()
      } catch (e) {
        toast({ text: errorMessage(e), tone: 'error' })
      }
    setBusy(false)
  }

  const add = (type: Bubble['type']) => {
    if (bubbles.length >= LIMITS.broadcastBubbles) return
    const nb: Bubble =
      type === 'text'
        ? { type, text: '' }
        : type === 'image'
          ? { type, url: '' }
          : type === 'card'
            ? { type, card: emptyCard() }
            : type === 'carousel'
              ? { type, cards: [emptyCard(), emptyCard()] }
              : { type: 'work', workId: '' }
    setBubbles([...bubbles, nb])
  }
  const move = (i: number, d: -1 | 1) => {
    const arr = [...bubbles]
    const j = i + d
    if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    setBubbles(arr)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/broadcasts" className="text-caption text-brand-text">
          ← 配信一覧
        </Link>
        {b.status && <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>}
      </div>
      <TextField
        label="管理用タイトル"
        value={b.title ?? ''}
        onChange={(e) => setB({ ...b, title: e.target.value })}
        placeholder="例：10月のメンテナンスのお知らせ"
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_340px]">
        {/* 吹き出しエディタ（左） */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-title-m">吹き出し</h2>
            <span className="text-caption text-fg2 tabular">
              {bubbles.length}/{LIMITS.broadcastBubbles}
            </span>
          </div>
          {bubbles.map((bubble, i) => (
            <div key={i} className="card space-y-2 p-3">
              <div className="flex items-center gap-1">
                <Badge>{{ text: 'テキスト', image: '画像', card: 'カード', carousel: 'カルーセル', work: '作品カード' }[bubble.type]}</Badge>
                <span className="flex-1" />
                {/* 2.5.7 ドラッグの代わりに「上へ」「下へ」 */}
                <IconButton label="上へ" className="size-9" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="下へ" className="size-9" disabled={i === bubbles.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton label="削除" className="size-9 text-danger" onClick={() => setBubbles(bubbles.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
              <BubbleEditor bubble={bubble} onChange={(nb) => setBubbles(bubbles.map((x, j) => (j === i ? nb : x)))} />
            </div>
          ))}
          {bubbles.length < LIMITS.broadcastBubbles && (
            <div className="flex flex-wrap gap-2">
              <Chip onClick={() => add('text')}>
                <Type className="size-4" />
                テキスト
              </Chip>
              <Chip onClick={() => add('image')}>
                <ImageIcon className="size-4" />
                画像
              </Chip>
              <Chip onClick={() => add('card')}>
                <CreditCard className="size-4" />
                カード
              </Chip>
              <Chip onClick={() => add('carousel')}>
                <GalleryHorizontal className="size-4" />
                カルーセル
              </Chip>
              <Chip onClick={() => add('work')}>
                <LayoutGrid className="size-4" />
                作品カード
              </Chip>
            </div>
          )}
          <p className="text-caption text-fg2">本文に {'{name}'} と書くと受信者の表示名に置き換わります。</p>
        </section>

        {/* 配信設定（中央） */}
        <section className="card h-fit space-y-4 p-4">
          <h2 className="text-title-m">配信設定</h2>
          <div>
            <p className="mb-2 text-label">宛先</p>
            <Segmented
              label="宛先"
              value={b.audience === 'segment' ? 'segment' : 'all'}
              onChange={(v) => setB({ ...b, audience: v, segmentQuery: v === 'segment' ? (b.segmentQuery ?? {}) : null })}
              options={[
                { value: 'all', label: '全員' },
                { value: 'segment', label: 'セグメント' },
              ]}
            />
          </div>
          {b.audience === 'segment' && (
            <div className="space-y-3 rounded-[12px] bg-surface p-3">
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  type="date"
                  label="登録日（以降）"
                  value={b.segmentQuery?.registeredAfter?.slice(0, 10) ?? ''}
                  onChange={(e) => setSeg({ registeredAfter: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                />
                <TextField
                  type="number"
                  label="最終ログイン（日以内）"
                  value={b.segmentQuery?.lastLoginWithinDays ?? ''}
                  onChange={(e) => setSeg({ lastLoginWithinDays: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>
              <div>
                <p className="mb-1 text-label">作品投稿</p>
                <Segmented
                  label="作品投稿"
                  size="sm"
                  value={b.segmentQuery?.hasWorks === undefined ? 'any' : b.segmentQuery.hasWorks ? 'yes' : 'no'}
                  onChange={(v) => setSeg({ hasWorks: v === 'any' ? undefined : v === 'yes' })}
                  options={[
                    { value: 'any', label: '指定なし' },
                    { value: 'yes', label: 'あり' },
                    { value: 'no', label: 'なし' },
                  ]}
                />
              </div>
              <div>
                <p className="mb-1 text-label">興味タグ</p>
                <div className="flex flex-wrap gap-1.5">
                  {INTEREST_TAGS.map((t) => (
                    <Chip
                      key={t}
                      selected={b.segmentQuery?.interests?.includes(t)}
                      onClick={() =>
                        setSeg({
                          interests: b.segmentQuery?.interests?.includes(t)
                            ? b.segmentQuery.interests.filter((x) => x !== t)
                            : [...(b.segmentQuery?.interests ?? []), t],
                        })
                      }
                    >
                      {t}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-label">制作依頼ステータス</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(COMMISSION) as CommissionStatus[]).map((k) => (
                    <Chip
                      key={k}
                      selected={b.segmentQuery?.commissionStatus?.includes(k)}
                      onClick={() =>
                        setSeg({
                          commissionStatus: b.segmentQuery?.commissionStatus?.includes(k)
                            ? b.segmentQuery.commissionStatus.filter((x) => x !== k)
                            : [...(b.segmentQuery?.commissionStatus ?? []), k],
                        })
                      }
                    >
                      {COMMISSION[k].label}
                    </Chip>
                  ))}
                </div>
              </div>
              <Switch
                label="テストユーザー（運営メンバー）のみ"
                checked={!!b.segmentQuery?.testUsersOnly}
                onChange={(v) => setSeg({ testUsersOnly: v || undefined })}
              />
            </div>
          )}
          {/* ZS-BC-02 送信前に対象人数を表示 */}
          <p className="text-body-m" aria-live="polite">
            対象 <span className="text-title-m tabular">{formatNumber(count)}</span> 人
          </p>
          <div>
            <p className="mb-2 text-label">配信日時</p>
            <Segmented
              label="配信日時"
              value={when}
              onChange={setWhen}
              options={[
                { value: 'now', label: '今すぐ' },
                { value: 'later', label: '予約' },
              ]}
            />
            {when === 'later' && (
              <div className="mt-2">
                <TextField
                  type="datetime-local"
                  label="予約日時（JST）"
                  value={b.scheduledAt ? toLocalInput(b.scheduledAt) : ''}
                  onChange={(e) => setB({ ...b, scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                />
              </div>
            )}
          </div>
          <TextField
            label="Push の通知文"
            value={b.pushText ?? ''}
            onChange={(e) => setB({ ...b, pushText: e.target.value })}
            maxLength={60}
            counter={{ value: (b.pushText ?? '').length, max: 60 }}
          />
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              variant="secondary"
              icon={<Save className="size-4" />}
              loading={busy}
              onClick={async () => (await save()) && toast({ text: '下書きを保存しました' })}
            >
              下書き保存
            </Button>
            <Button
              variant="secondary"
              icon={<FlaskConical className="size-4" />}
              loading={busy}
              onClick={() => act(async (bid) => toast({ text: `運営メンバー${await api.admin.testSend(bid)}人に送りました` }), 'テスト送信しました')}
            >
              テスト送信
            </Button>
            {onlyRequest || (approvalOn && b.status !== 'pending' && !canApprove) ? (
              <Button
                className="col-span-2"
                loading={busy}
                onClick={() =>
                  act(
                    (bid) => api.admin.requestApproval(bid),
                    '承認依頼を送りました',
                    () => navigate('/admin/broadcasts'),
                  )
                }
              >
                承認依頼
              </Button>
            ) : (
              <>
                {approvalOn && b.status !== 'pending' && (
                  <Button variant="ghost" loading={busy} onClick={() => act((bid) => api.admin.requestApproval(bid), '承認依頼を送りました')}>
                    承認依頼
                  </Button>
                )}
                <Button
                  className={cn(!(approvalOn && b.status !== 'pending') && 'col-span-2')}
                  variant="signature"
                  icon={<Send className="size-4" />}
                  loading={busy}
                  onClick={() => setConfirm(true)}
                >
                  {approvalOn ? '承認して' : ''}
                  {when === 'later' ? '予約する' : '配信する'}
                </Button>
              </>
            )}
          </div>
          {approvalOn && <p className="text-caption text-fg2">承認フローがオンです。配信担当は「承認依頼」を出し、管理者以上が承認して送信します。</p>}
        </section>

        {/* スマホプレビュー（右） */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-title-m">プレビュー</h2>
            <Segmented
              label="プレビューのテーマ"
              size="sm"
              value={previewTheme}
              onChange={setPreviewTheme}
              options={[
                { value: 'dark', label: 'ダーク' },
                { value: 'light', label: 'ライト' },
              ]}
            />
          </div>
          <div data-theme={previewTheme} className="mx-auto w-[300px] overflow-hidden rounded-[36px] border-[6px] border-[#2b3a33] bg-base text-fg">
            <div className="glass flex items-center gap-2 border-b border-subtle px-3 py-2.5">
              <Avatar name="z" color="#1F4D3B" size={28} verified />
              <span className="text-body-m font-bold">zenospace 公式</span>
            </div>
            <div className="min-h-[420px] space-y-2 p-3">
              {bubbles.map((bubble, i) => (
                <PreviewBubble key={i} bubble={bubble} />
              ))}
            </div>
          </div>
          <div data-theme={previewTheme} className="mx-auto w-[300px] rounded-[16px] border border-subtle bg-elevated p-3 text-fg">
            <p className="text-caption text-fg2">Push 通知</p>
            <p className="text-body-m font-bold">zenospace</p>
            <p className="text-body-m">{b.pushText || '（通知文を入力）'}</p>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={when === 'later' ? '配信を予約しますか？' : '今すぐ配信しますか？'}
        body={`対象 ${formatNumber(count)}人に${when === 'later' && b.scheduledAt ? `${formatDateTime(b.scheduledAt)}に` : '今すぐ'}配信します。送信後24時間以内なら取り消せます。`}
        confirmLabel={when === 'later' ? '予約する' : '配信する'}
        loading={busy}
        onConfirm={() =>
          act(
            (bid) => api.admin.approveAndSend(bid),
            when === 'later' ? '予約しました' : '配信しました',
            () => (setConfirm(false), navigate('/admin/broadcasts')),
          )
        }
      />
    </div>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function CardEditor({ card, onChange }: { card: RichCard; onChange: (c: RichCard) => void }) {
  return (
    <div className="space-y-2 rounded-[12px] bg-surface p-2">
      <TextField label="画像URL（任意）" value={card.imageUrl ?? ''} onChange={(e) => onChange({ ...card, imageUrl: e.target.value || undefined })} />
      <TextField label="見出し" value={card.title} onChange={(e) => onChange({ ...card, title: e.target.value })} />
      <TextArea label="本文" rows={2} value={card.body ?? ''} onChange={(e) => onChange({ ...card, body: e.target.value })} />
      {(card.buttons ?? []).map((btn, i) => (
        <div key={i} className="flex items-end gap-2">
          <div className="flex-1">
            <TextField
              label={`ボタン${i + 1}`}
              value={btn.label}
              onChange={(e) => onChange({ ...card, buttons: card.buttons!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
            />
          </div>
          <div className="flex-1">
            <TextField
              label="リンク先"
              value={btn.url}
              onChange={(e) => onChange({ ...card, buttons: card.buttons!.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
              placeholder="/post または https://"
            />
          </div>
          <IconButton label="ボタンを削除" onClick={() => onChange({ ...card, buttons: card.buttons!.filter((_, j) => j !== i) })}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      ))}
      {(card.buttons?.length ?? 0) < 3 && (
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-4" />}
          onClick={() => onChange({ ...card, buttons: [...(card.buttons ?? []), { key: `btn${Date.now()}`, label: '', url: '' }] })}
        >
          ボタンを追加（最大3つ）
        </Button>
      )}
    </div>
  )
}

function BubbleEditor({ bubble, onChange }: { bubble: Bubble; onChange: (b: Bubble) => void }) {
  const works = useLive(() => api.works.list({}, { offset: 0, limit: 50 }), [])
  switch (bubble.type) {
    case 'text':
      return <TextArea value={bubble.text} rows={3} onChange={(e) => onChange({ ...bubble, text: e.target.value })} aria-label="テキスト" />
    case 'image':
      return <TextField label="画像URL" value={bubble.url} onChange={(e) => onChange({ ...bubble, url: e.target.value })} />
    case 'card':
      return <CardEditor card={bubble.card} onChange={(card) => onChange({ ...bubble, card })} />
    case 'carousel':
      return (
        <div className="space-y-2">
          {bubble.cards.map((c, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-caption text-fg2">
                カード {i + 1}
                <button className="text-danger" onClick={() => onChange({ ...bubble, cards: bubble.cards.filter((_, j) => j !== i) })}>
                  削除
                </button>
              </div>
              <CardEditor card={c} onChange={(nc) => onChange({ ...bubble, cards: bubble.cards.map((x, j) => (j === i ? nc : x)) })} />
            </div>
          ))}
          {bubble.cards.length < 10 && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange({ ...bubble, cards: [...bubble.cards, emptyCard()] })}>
              カードを追加（最大10枚）
            </Button>
          )}
        </div>
      )
    case 'work':
      return (
        <select
          value={bubble.workId}
          onChange={(e) => onChange({ ...bubble, workId: e.target.value })}
          aria-label="作品"
          className="min-h-11 w-full rounded-[12px] border border-subtle bg-surface px-3"
        >
          <option value="">作品を選ぶ</option>
          {works.data?.items.map(({ work }) => (
            <option key={work.id} value={work.id}>
              {work.title}
            </option>
          ))}
        </select>
      )
  }
}

function PreviewBubble({ bubble }: { bubble: Bubble }) {
  const Card = ({ c }: { c: RichCard }) => (
    <div className="w-52 shrink-0 overflow-hidden rounded-[14px] border border-subtle bg-surface">
      {c.imageUrl && <img src={c.imageUrl} alt="" className="aspect-[16/10] w-full object-cover" />}
      <div className="p-2.5">
        <p className="text-body-m font-bold">{c.title || '見出し'}</p>
        {c.body && <p className="text-caption text-fg2">{c.body}</p>}
      </div>
      {c.buttons?.map((b) => (
        <p key={b.key} className="border-t border-subtle py-2 text-center text-label text-brand-text">
          {b.label || 'ボタン'}
        </p>
      ))}
    </div>
  )
  switch (bubble.type) {
    case 'text':
      return (
        <div className="relative max-w-[85%] overflow-hidden rounded-[18px] border border-subtle bg-bubble-official px-3 py-2 text-body-m whitespace-pre-wrap">
          <span className="bg-signature absolute inset-y-0 left-0 w-0.5" />
          {bubble.text.replaceAll('{name}', 'くら') || '（テキスト）'}
        </div>
      )
    case 'image':
      return bubble.url ? <img src={bubble.url} alt="" className="w-48 rounded-[14px]" /> : <div className="h-28 w-48 rounded-[14px] bg-elevated" />
    case 'card':
      return <Card c={bubble.card} />
    case 'carousel':
      return (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {bubble.cards.map((c, i) => (
            <Card key={i} c={c} />
          ))}
        </div>
      )
    case 'work': {
      const w = api.works.workSync(bubble.workId)
      return w ? (
        <div className="flex w-56 items-center gap-2 rounded-[14px] border border-subtle bg-surface p-2">
          <img src={w.media[0]?.thumbUrl} alt="" className="aspect-[16/10] w-20 rounded-[8px] object-cover" />
          <span className="line-clamp-2 text-caption font-bold">{w.title}</span>
        </div>
      ) : (
        <div className="h-16 w-56 rounded-[14px] bg-elevated" />
      )
    }
  }
}

/** A-09 配信レポート：開封率、タップ率、ボタン別の結果（ZS-BC-08） */
export function BroadcastReport() {
  const { id = '' } = useParams()
  const { data } = useLive(() => api.admin.broadcastReport(id), [id])
  const role = useAdminRole()
  const toast = useToast()
  const [cancel, setCancel] = useState(false)
  if (!data) return <p className="text-fg2">読み込み中…</p>
  const b = data.broadcast
  const canCancel = can(role, 'broadcastApprove') && !b.canceledAt && b.sentAt && Date.now() - new Date(b.sentAt).getTime() < 86400_000
  const maxBtn = Math.max(1, ...data.buttons.map((x) => x.count))
  return (
    <div className="space-y-6">
      <Link to="/admin/broadcasts" className="text-caption text-brand-text">
        ← 配信一覧
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-title-l">{b.title || '無題'}</h1>
        {b.canceledAt ? <Badge tone="danger">取り消し済み</Badge> : <Badge tone="success">送信済み</Badge>}
        <span className="text-caption text-fg2">{b.sentAt && formatDateTime(b.sentAt)}</span>
        {canCancel && (
          <Button size="sm" variant="ghost" className="ml-auto text-danger" icon={<Undo2 className="size-4" />} onClick={() => setCancel(true)}>
            配信を取り消す
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['配信対象', formatNumber(data.target)],
          ['Push 到達', formatNumber(data.pushDelivered)],
          ['開封', formatNumber(data.reads)],
          ['開封率', `${Math.round(data.openRate * 100)}%`],
          ['タップ率', `${Math.round(data.clickRate * 100)}%`],
        ].map(([k, v]) => (
          <div key={k} className="card p-4">
            <p className="text-caption text-fg2">{k}</p>
            <p className="text-title-l">{v}</p>
          </div>
        ))}
      </div>
      <section className="card space-y-3 p-5">
        <h2 className="text-title-m">ボタンごとのタップ数</h2>
        {data.buttons.length === 0 && <p className="text-body-m text-fg2">ボタンのタップはまだありません</p>}
        {/* 1系列の横棒：太さ24px以下、先端4pxの角丸、値は先端に */}
        <ul className="space-y-2">
          {data.buttons.map((x) => (
            <li key={x.key} className="grid grid-cols-[minmax(0,1fr)_2fr] items-center gap-3 text-body-m">
              <span className="truncate text-fg2">{x.label}</span>
              <span className="flex items-center gap-2">
                <span className="h-5 rounded-r-[4px] bg-brand-text" style={{ width: `${(x.count / maxBtn) * 85}%` }} />
                <span className="tabular">{x.count}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <ConfirmDialog
        open={cancel}
        onClose={() => setCancel(false)}
        title="配信を取り消しますか？"
        body="全員の画面からこの配信が消えます。"
        confirmLabel="取り消す"
        danger
        onConfirm={async () => {
          try {
            await api.admin.cancelBroadcast(b.id)
            toast({ text: '配信を取り消しました' })
          } catch (e) {
            toast({ text: errorMessage(e), tone: 'error' })
          }
          setCancel(false)
        }}
      />
    </div>
  )
}
