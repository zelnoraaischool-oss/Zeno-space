import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ImagePlus, ArrowUp, ArrowDown, Trash2, Star, Link2, Check, X, Loader2 } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive, useSync } from '@/hooks/useLive'
import { useMe } from '@/app/session'
import { PageHeader } from '@/components/layout/AppLayout'
import { Badge, Button, Chip, IconButton, Segmented, Select, Skeleton, TextArea, TextField } from '@/components/ui/primitives'
import { FullError } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { ImageCropper, type CropRect } from '@/components/ImageCropper'
import { WorkCard, WorkTypeIcon } from '@/components/work/WorkCard'
import { ShareSheet } from '@/components/work/ShareSheet'
import { LIMITS, PERIOD_UNITS, PRODUCTION_TYPES, ROLES, WORK_TYPES } from '@/lib/constants'
import { formatTime } from '@/lib/format'
import { uuid } from '@/lib/ids'
import type { Work, WorkMedia, WorkType } from '@/lib/types'
import { cn } from '@/lib/cn'

const STEPS = ['種類', 'メディア', '詳細', 'プレビュー']

/** U-08 作品投稿：4段階のステッパー。各段階を自動保存し、下書きから再開できる（ZS-WORK-01） */
export default function Post() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const me = useMe()
  const caps = useSync(() => api.users.myCapabilities())
  const creating = useRef(false)

  // 新規：種類を選んだら下書きを作って /post/:id へ
  useEffect(() => {
    const type = params.get('type') as WorkType | null
    if (id || !type || creating.current || !me) return
    creating.current = true
    api.works
      .createDraft(type)
      .then(async (w) => {
        // Web Share Target（15.4）：他のアプリから共有された URL を初期値にする
        const shared = params.get('url')
        if (shared) await api.works.update(w.id, { url: shared })
        navigate(`/post/${w.id}?step=1`, { replace: true })
      })
      .catch((e) => {
        toast({ text: errorMessage(e), tone: 'error' })
        navigate('/home', { replace: true })
      })
  }, [id, params, me, navigate, toast])

  if (!me) return <Navigate to="/login" replace />
  if (caps && !caps.canPostWork) return <FullError title="作品の投稿は制限されています" body="制限の内容は設定の「利用制限」から確認できます" />
  if (!id) return params.get('type') ? <Skeleton className="m-4 h-64" /> : <TypePicker />
  return <Editor id={id} />
}

function TypePicker() {
  const navigate = useNavigate()
  return (
    <>
      <PageHeader title="作品を投稿" back />
      <div className="mx-auto max-w-2xl p-4">
        <p className="mb-4 text-body-m text-fg2">選んだ種類で、必要な項目が変わります。</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {WORK_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => navigate(`/post?type=${t.value}`)}
              className="card flex min-h-32 flex-col items-start gap-2 p-4 text-left hover:bg-elevated"
            >
              <span className="bg-signature flex size-10 items-center justify-center rounded-full text-white">
                <WorkTypeIcon type={t.value} className="size-5" />
              </span>
              <span className="text-body-m font-bold">{t.label}</span>
              <span className="text-caption text-fg2">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function Editor({ id }: { id: string }) {
  const { data, loading } = useLive(() => api.works.get(id), [id])
  const [params, setParams] = useSearchParams()
  const step = Math.min(3, Math.max(0, Number(params.get('step') ?? 1)))
  const [draft, setDraft] = useState<Work | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const published = useRef(false)
  const dirty = useRef(false)
  const toast = useToast()
  const me = useMe()

  useEffect(() => {
    if (data && (!draft || draft.id !== data.work.id)) setDraft(structuredClone(data.work))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  // 入力が止まって1秒後に自動保存する
  const save = useCallback(
    async (w: Work) => {
      setSaving(true)
      try {
        const { id: _id, ownerId: _o, likeCount: _l, viewCount: _v, status: _s, ...patch } = w
        await api.works.update(w.id, patch)
        setSavedAt(new Date().toISOString())
        dirty.current = false
      } catch (e) {
        toast({ text: errorMessage(e), tone: 'error' })
      } finally {
        setSaving(false)
      }
    },
    [toast],
  )
  useEffect(() => {
    if (!draft || !dirty.current) return
    const t = setTimeout(() => void save(draft), 1000)
    return () => clearTimeout(t)
  }, [draft, save])

  // 途中で閉じても確認ダイアログは出さず、トーストで知らせる
  useEffect(
    () => () => {
      if (!published.current && draft?.visibility === 'draft') toast({ text: '下書きに保存しました' })
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (loading && !data) return <Skeleton className="m-4 h-64" />
  if (!data || !draft || data.work.ownerId !== me?.id) return <FullError title="作品が見つかりません" />

  const set = (patch: Partial<Work>) => {
    dirty.current = true
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }
  const go = async (n: number) => {
    if (dirty.current) await save(draft)
    setParams({ step: String(n) }, { replace: true })
    window.scrollTo({ top: 0 })
  }
  const missing = api.works.validate(draft)

  return (
    <>
      <PageHeader
        title={draft.visibility === 'draft' ? '作品を投稿' : '作品を編集'}
        back="/me/works"
        actions={
          <span className="pr-2 text-caption text-fg2" aria-live="polite">
            {saving ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                保存中
              </span>
            ) : savedAt ? (
              `下書き保存済み ${formatTime(savedAt)}`
            ) : null}
          </span>
        }
      >
        {/* 進捗バー */}
        <div className="px-4 pb-3">
          <ol className="flex gap-2">
            {STEPS.map((s, i) => (
              <li key={s} className="flex-1">
                <button onClick={() => go(i)} className="w-full text-left" aria-current={i === step ? 'step' : undefined}>
                  <span className={cn('block h-1 rounded-full transition-colors duration-300', i <= step ? 'bg-signature' : 'bg-elevated')} />
                  <span className={cn('mt-1 block text-caption', i === step ? 'text-fg' : 'text-fg2')}>
                    {i + 1} {s}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </PageHeader>
      <div className="mx-auto max-w-2xl space-y-6 p-4 pb-32">
        {step === 0 && <StepType draft={draft} set={set} />}
        {step === 1 && <StepMedia draft={draft} set={set} />}
        {step === 2 && <StepDetails draft={draft} set={set} missing={missing} />}
        {step === 3 && <StepPreview draft={draft} missing={missing} onPublished={() => (published.current = true)} save={() => save(draft)} />}
      </div>
      {step < 3 && (
        <div className="glass fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 border-t border-subtle p-3 lg:bottom-0 lg:left-64">
          <div className="mx-auto flex max-w-2xl gap-2">
            {step > 0 && (
              <Button variant="secondary" className="shrink-0" onClick={() => go(step - 1)}>
                戻る
              </Button>
            )}
            <Button block size="lg" onClick={() => go(step + 1)}>
              次へ：{STEPS[step + 1]}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

type StepProps = { draft: Work; set: (p: Partial<Work>) => void }

function StepType({ draft, set }: StepProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {WORK_TYPES.map((t) => (
        <button
          key={t.value}
          onClick={() => set({ type: t.value })}
          aria-pressed={draft.type === t.value}
          className={cn('card flex min-h-28 flex-col items-start gap-2 p-4 text-left', draft.type === t.value && 'border-brand-text ring-2 ring-brand/40')}
        >
          <WorkTypeIcon type={t.value} className="size-6 text-brand-text" />
          <span className="text-body-m font-bold">{t.label}</span>
          <span className="text-caption text-fg2">{t.desc}</span>
        </button>
      ))}
    </div>
  )
}

/** 2 メディア：URL 入力で OGP を取得、画像の追加（ドラッグ、貼り付け、カメラロール）、表紙の指定 */
function StepMedia({ draft, set }: StepProps) {
  const toast = useToast()
  const [ogp, setOgp] = useState<'idle' | 'loading' | { title: string; description: string }>('idle')
  const [cropping, setCropping] = useState<{ file: File; queue: File[] } | null>(null)
  const [uploading, setUploading] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const needsUrl = draft.type === 'hp' || draft.type === 'lp'
  const urlField = draft.type === 'app' ? 'storeUrl' : draft.type === 'video' ? 'videoUrl' : 'url'

  const addFiles = (files: File[]) => {
    const room = LIMITS.galleryImages + 1 - draft.media.length
    const list = files.filter((f) => f.type.startsWith('image/')).slice(0, room)
    if (!list.length) return
    if (draft.media.length === 0)
      setCropping({ file: list[0], queue: list.slice(1) }) // 表紙は 16:10 に切り抜く
    else void upload(list)
  }
  const upload = async (files: File[], crop?: CropRect, cover = false) => {
    setUploading((n) => n + files.length)
    const added: WorkMedia[] = []
    for (const f of files) {
      try {
        const up = await api.storage.uploadImage(f, { kind: 'work', crop: cover ? crop : undefined })
        added.push({ id: uuid(), url: up.url, thumbUrl: up.thumbUrl, width: up.width, height: up.height, altText: '', dominantColor: up.dominantColor })
      } catch (e) {
        toast({ text: errorMessage(e), tone: 'error' })
      } finally {
        setUploading((n) => n - 1)
      }
    }
    set({ media: cover ? [...added, ...draft.media] : [...draft.media, ...added] })
    return added
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const move = (i: number, d: -1 | 1) => {
    const m = [...draft.media]
    const j = i + d
    if (j < 0 || j >= m.length) return
    ;[m[i], m[j]] = [m[j], m[i]]
    set({ media: m })
  }

  const fetchOgp = async () => {
    const url = draft[urlField]
    if (!url) return
    setOgp('loading')
    try {
      const r = await api.works.fetchOgp(url)
      setOgp(r)
      if (!draft.title) set({ title: r.title.slice(0, LIMITS.workTitle), catchCopy: draft.catchCopy || r.description.slice(0, LIMITS.catchCopy) })
    } catch (e) {
      setOgp('idle')
      toast({ text: errorMessage(e), tone: 'error' })
    }
  }

  return (
    <>
      {draft.type !== 'image' && draft.type !== 'other' && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                type="url"
                label={draft.type === 'app' ? 'ストアURLまたはWeb URL' : draft.type === 'video' ? '動画URL（YouTube / Vimeo）' : '公開URL'}
                required={needsUrl || draft.type === 'video' || draft.type === 'app'}
                value={draft[urlField]}
                onChange={(e) => set({ [urlField]: e.target.value } as Partial<Work>)}
                onBlur={fetchOgp}
                placeholder="https://"
              />
            </div>
            <Button variant="secondary" onClick={fetchOgp} icon={<Link2 className="size-4" />}>
              取得
            </Button>
          </div>
          {ogp === 'loading' && (
            <div className="card space-y-2 p-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          )}
          {typeof ogp === 'object' && (
            <div className="card anim-fade flex items-start gap-2 p-3 text-body-m">
              <Check className="mt-0.5 size-4 text-success" />
              <div>
                <p className="font-bold">{ogp.title}</p>
                <p className="text-caption text-fg2">{ogp.description}（タイトルの候補に入れました）</p>
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-label">
            {draft.type === 'image' ? '画像（1〜10枚）' : 'サムネイルとギャラリー'}
            <span className="ml-1 text-danger">*</span>
          </p>
          <span className="text-caption text-fg2 tabular">
            {draft.media.length}/{LIMITS.galleryImages + 1}
          </span>
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            addFiles([...e.dataTransfer.files])
          }}
          className="space-y-2"
        >
          {draft.media.map((m, i) => (
            <div key={m.id} className="card flex items-center gap-3 p-2">
              <img src={m.thumbUrl} alt="" className="aspect-[16/10] w-28 rounded-[8px] object-cover" />
              <div className="min-w-0 flex-1 space-y-1">
                {i === 0 && <Badge tone="brand">表紙</Badge>}
                <input
                  value={m.altText}
                  onChange={(e) => set({ media: draft.media.map((x) => (x.id === m.id ? { ...x, altText: e.target.value } : x)) })}
                  placeholder="代替テキスト（読み上げ用・任意）"
                  aria-label={`画像 ${i + 1} の代替テキスト`}
                  className="w-full rounded-[8px] border border-subtle bg-base px-2 py-1.5 text-body-m"
                />
              </div>
              {/* 2.5.7 ドラッグ以外でも並べ替えられるよう「上へ」「下へ」を用意する */}
              <div className="flex flex-col">
                <IconButton label="上へ" onClick={() => move(i, -1)} disabled={i === 0} className="size-9 disabled:opacity-30">
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="下へ" onClick={() => move(i, 1)} disabled={i === draft.media.length - 1} className="size-9 disabled:opacity-30">
                  <ArrowDown className="size-4" />
                </IconButton>
              </div>
              <div className="flex flex-col">
                {i > 0 && (
                  <IconButton label="表紙にする" onClick={() => set({ media: [m, ...draft.media.filter((x) => x.id !== m.id)] })} className="size-9">
                    <Star className="size-4" />
                  </IconButton>
                )}
                <IconButton label="削除" onClick={() => set({ media: draft.media.filter((x) => x.id !== m.id) })} className="size-9 text-danger">
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
          {draft.media.length < LIMITS.galleryImages + 1 && (
            <button
              onClick={() => inputRef.current?.click()}
              className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-subtle text-fg2 hover:border-brand-text hover:text-fg"
            >
              <ImagePlus className="size-6" strokeWidth={1.5} />
              <span className="text-body-m">画像を追加（ドラッグ・貼り付けもできます）</span>
              <span className="text-caption">端末で WebP に変換し、位置情報を削除してから送ります</span>
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>
      <ImageCropper
        file={cropping?.file ?? null}
        aspect={16 / 10}
        title="表紙を切り抜く（16:10）"
        onCancel={() => {
          if (cropping) void upload([cropping.file, ...cropping.queue])
          setCropping(null)
        }}
        onDone={async (crop) => {
          const c = cropping!
          setCropping(null)
          await upload([c.file], crop, true)
          if (c.queue.length) void upload(c.queue)
        }}
      />
    </>
  )
}

/** 3 詳細：7.2 の項目。使用技術とタグは候補チップから選ぶ。必須項目の残り数を上部に表示する */
function StepDetails({ draft, set, missing }: StepProps & { missing: string[] }) {
  const cats = useSync(() => api.works.categories())
  const techs = useSync(() => api.works.techs())
  const tags = useSync(() => api.works.popularTags())
  const [tagInput, setTagInput] = useState('')
  const addTag = (t: string) => {
    const v = t.trim().replace(/^#/, '')
    if (!v || draft.tags.includes(v) || draft.tags.length >= LIMITS.tags) return
    set({ tags: [...draft.tags, v] })
    setTagInput('')
  }
  const detailMissing = missing.filter((m) => ['タイトル', 'カテゴリ', '制作形態', 'クライアントの掲載許諾の確認'].includes(m))
  return (
    <>
      <div
        className={cn('rounded-[12px] px-3 py-2 text-body-m', detailMissing.length ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success')}
        aria-live="polite"
      >
        {detailMissing.length ? `必須項目があと${detailMissing.length}つあります：${detailMissing.join('、')}` : '必須項目はすべて入力済みです'}
      </div>
      <TextField
        label="タイトル"
        required
        value={draft.title}
        maxLength={LIMITS.workTitle}
        counter={{ value: draft.title.length, max: LIMITS.workTitle }}
        onChange={(e) => set({ title: e.target.value })}
      />
      <TextField
        label="キャッチコピー"
        value={draft.catchCopy}
        maxLength={LIMITS.catchCopy}
        counter={{ value: draft.catchCopy.length, max: LIMITS.catchCopy }}
        onChange={(e) => set({ catchCopy: e.target.value })}
        hint="カードに表示されます"
      />
      <TextArea
        label="説明"
        value={draft.description}
        rows={8}
        maxLength={LIMITS.description}
        counter={{ value: draft.description.length, max: LIMITS.description }}
        onChange={(e) => set({ description: e.target.value })}
        hint="「# 見出し」「- 箇条書き」とURLのリンクが使えます"
      />
      <fieldset>
        <legend className="mb-2 text-label">
          カテゴリ（業種）<span className="ml-1 text-danger">*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <Chip key={c.id} selected={draft.categoryId === c.id} onClick={() => set({ categoryId: c.id })}>
              {c.name}
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-label">
          使用技術{' '}
          <span className="text-caption text-fg2 tabular">
            {draft.techIds.length}/{LIMITS.techs}
          </span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {/* 前回の投稿で使った技術を候補の先頭に出す */}
          {[...techs]
            .sort((a, b) => Number(draft.techIds.includes(b.id)) - Number(draft.techIds.includes(a.id)))
            .map((t) => (
              <Chip
                key={t.id}
                selected={draft.techIds.includes(t.id)}
                disabled={!draft.techIds.includes(t.id) && draft.techIds.length >= LIMITS.techs}
                onClick={() => set({ techIds: draft.techIds.includes(t.id) ? draft.techIds.filter((x) => x !== t.id) : [...draft.techIds, t.id] })}
              >
                {t.name}
              </Chip>
            ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-label">
          タグ{' '}
          <span className="text-caption text-fg2 tabular">
            {draft.tags.length}/{LIMITS.tags}
          </span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {draft.tags.map((t) => (
            <Chip key={t} selected onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })}>
              #{t} <X className="size-3.5" />
            </Chip>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            addTag(tagInput)
          }}
          className="flex gap-2"
        >
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="タグを入力してEnter"
            aria-label="タグを追加"
            className="min-h-11 flex-1 rounded-[12px] border border-subtle bg-surface px-3"
          />
          <Button type="submit" variant="secondary">
            追加
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {tags
            .filter((t) => !draft.tags.includes(t))
            .slice(0, 10)
            .map((t) => (
              <button key={t} type="button" onClick={() => addTag(t)} className="min-h-8 rounded-full px-2 text-caption text-brand-text hover:bg-surface">
                +{t}
              </button>
            ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-label">
          制作形態<span className="ml-1 text-danger">*</span>
        </legend>
        <Segmented
          label="制作形態"
          value={draft.productionType ?? ('' as never)}
          onChange={(v) => set({ productionType: v })}
          options={PRODUCTION_TYPES.map((p) => ({ value: p.value, label: p.label }))}
        />
        {draft.productionType === 'client' && (
          <label className="mt-3 flex min-h-11 items-start gap-3 rounded-[12px] border border-warning/40 bg-warning/5 p-3 text-body-m">
            <input
              type="checkbox"
              checked={draft.licenseConfirmed}
              onChange={(e) => set({ licenseConfirmed: e.target.checked })}
              className="mt-0.5 size-5 accent-[var(--brand-primary)]"
            />
            <span>
              クライアントの掲載許諾を得ています<span className="ml-1 text-danger">*</span>
            </span>
          </label>
        )}
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-label">担当範囲</legend>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <Chip
              key={r}
              selected={draft.roles.includes(r)}
              onClick={() => set({ roles: draft.roles.includes(r) ? draft.roles.filter((x) => x !== r) : [...draft.roles, r] })}
            >
              {r}
            </Chip>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          type="number"
          inputMode="numeric"
          min={1}
          label="制作期間"
          value={draft.periodValue ?? ''}
          onChange={(e) => set({ periodValue: e.target.value ? Number(e.target.value) : null, periodUnit: draft.periodUnit ?? 'week' })}
        />
        <Select
          label="単位"
          value={draft.periodUnit ?? 'week'}
          onChange={(v) => set({ periodUnit: v as Work['periodUnit'] })}
          options={PERIOD_UNITS.map((u) => ({ value: u.value, label: u.label }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          type="number"
          inputMode="numeric"
          min={0}
          step={1000}
          label="参考価格（下限・円）"
          value={draft.priceMin ?? ''}
          onChange={(e) => set({ priceMin: e.target.value ? Number(e.target.value) : null })}
        />
        <TextField
          type="number"
          inputMode="numeric"
          min={0}
          step={1000}
          label="参考価格（上限・円）"
          value={draft.priceMax ?? ''}
          onChange={(e) => set({ priceMax: e.target.value ? Number(e.target.value) : null })}
          hint="同等の制作を依頼する場合の目安"
        />
      </div>
    </>
  )
}

/** 4 プレビュー：他の人に見える状態で表示し、公開範囲を選んで「公開する」 */
function StepPreview({ draft, missing, onPublished, save }: { draft: Work; missing: string[]; onPublished: () => void; save: () => Promise<void> }) {
  const me = useMe()!
  const navigate = useNavigate()
  const toast = useToast()
  const [vis, setVis] = useState<'public' | 'unlisted' | 'draft'>(draft.visibility === 'draft' ? 'public' : draft.visibility)
  const [busy, setBusy] = useState(false)
  const [flying, setFlying] = useState(false)
  const [share, setShare] = useState(false)
  return (
    <>
      <div className="mx-auto w-full max-w-xs">
        <div
          className={cn(
            'transition-all duration-[600ms] ease-[var(--ease-standard)]',
            flying && 'pointer-events-none -translate-y-24 scale-50 opacity-0 drop-shadow-[0_0_24px_rgba(124,92,255,.9)]',
          )}
        >
          <WorkCard work={draft} owner={me} />
        </div>
      </div>
      {missing.length > 0 && (
        <div className="rounded-[12px] border border-warning/40 bg-warning/10 p-3 text-body-m" role="alert">
          公開する前に入力してください：{missing.join('、')}
        </div>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-label">公開範囲</legend>
        {[
          { v: 'public', l: '公開', d: '誰でも見られ、一覧や検索に表示されます' },
          { v: 'unlisted', l: '限定公開', d: 'URLを知っている人だけが見られます' },
          { v: 'draft', l: '下書き', d: '自分だけが見られます' },
        ].map((o) => (
          <label key={o.v} className={cn('card flex min-h-14 items-center gap-3 p-3', vis === o.v && 'border-brand-text')}>
            <input type="radio" name="vis" checked={vis === o.v} onChange={() => setVis(o.v as typeof vis)} className="size-5 accent-[var(--brand-primary)]" />
            <span>
              <span className="block text-body-m font-bold">{o.l}</span>
              <span className="block text-caption text-fg2">{o.d}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button
        variant="signature"
        size="lg"
        block
        loading={busy}
        disabled={vis !== 'draft' && missing.length > 0}
        onClick={async () => {
          setBusy(true)
          try {
            await save()
            if (vis === 'draft') {
              await api.works.setVisibility(draft.id, 'draft')
              toast({ text: '下書きに保存しました' })
              navigate('/me/works')
              return
            }
            await api.works.publish(draft.id, vis)
            onPublished()
            // カードが光りながら縮み、グリッドへ収まる（600ms）→ 共有シート
            setFlying(true)
            setTimeout(() => setShare(true), 650)
          } catch (e) {
            toast({ text: errorMessage(e), tone: 'error' })
          } finally {
            setBusy(false)
          }
        }}
      >
        {vis === 'draft' ? '下書きとして保存' : draft.publishedAt ? '更新する' : '公開する'}
      </Button>
      <ShareSheet
        open={share}
        onClose={() => {
          setShare(false)
          navigate(`/works/${draft.id}`)
        }}
        work={draft}
      />
    </>
  )
}
