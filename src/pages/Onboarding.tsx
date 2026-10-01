import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Camera, Bell, Share } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useMe } from '@/app/session'
import { INTEREST_TAGS, LIMITS } from '@/lib/constants'
import { Avatar, Button, Chip, TextField } from '@/components/ui/primitives'
import { PlanetArt } from '@/components/ui/illustrations'
import { useToast } from '@/components/ui/toast'
import { isIos, isStandalone } from '@/lib/pwa'

/** U-03 オンボーディング：3ステップ（アイコンと表示名、興味タグ、通知とホーム画面追加）。スキップ可 */
export default function Onboarding() {
  const me = useMe()
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [name, setName] = useState(me?.displayName ?? '')
  const [avatar, setAvatar] = useState<string | null>(me?.avatarUrl ?? null)
  const [tags, setTags] = useState<string[]>(me?.interests ?? [])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  if (!me) return <Navigate to="/login" replace />

  const finish = async () => {
    await api.users.updateProfile({ onboarded: true })
    navigate('/home', { replace: true })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8">
      <div className="mb-8 flex items-center gap-2" aria-label={`ステップ ${step + 1}/3`}>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= step ? 'bg-signature' : 'bg-elevated'}`} />
        ))}
      </div>

      {step === 0 && (
        <div className="flex flex-1 flex-col gap-6">
          <div>
            <h1 className="text-display">ようこそ</h1>
            <p className="mt-2 text-body-m text-fg2">アイコンと表示名を設定しましょう。あとから変えられます。</p>
          </div>
          <button className="relative mx-auto" onClick={() => fileRef.current?.click()} aria-label="アイコンを選ぶ">
            <Avatar name={name || me.displayName} color={me.avatarColor} url={avatar} size={112} />
            <span className="bg-signature absolute bottom-0 right-0 flex size-9 items-center justify-center rounded-full text-white ring-4 ring-[var(--bg-base)]">
              <Camera className="size-4" />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                const up = await api.storage.uploadImage(f, { kind: 'avatar' })
                setAvatar(up.url)
              } catch (err) {
                toast({ text: errorMessage(err), tone: 'error' })
              }
            }}
          />
          <TextField
            label="表示名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={LIMITS.displayName}
            counter={{ value: name.length, max: LIMITS.displayName }}
          />
          <div className="mt-auto flex gap-2">
            <Button variant="ghost" block onClick={() => setStep(1)}>
              スキップ
            </Button>
            <Button
              block
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await api.users.updateProfile({ displayName: name, avatarUrl: avatar })
                  setStep(1)
                } catch (err) {
                  toast({ text: errorMessage(err), tone: 'error' })
                } finally {
                  setBusy(false)
                }
              }}
            >
              次へ
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-1 flex-col gap-6">
          <div>
            <h1 className="text-title-l">興味のあることは？</h1>
            <p className="mt-2 text-body-m text-fg2">選んだタグをもとに、ホームでおすすめの作品を表示します。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {INTEREST_TAGS.map((t) => (
              <Chip key={t} selected={tags.includes(t)} onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
                {t}
              </Chip>
            ))}
          </div>
          <div className="mt-auto flex gap-2">
            <Button variant="ghost" block onClick={() => setStep(2)}>
              スキップ
            </Button>
            <Button
              block
              onClick={async () => {
                await api.users.updateProfile({ interests: tags })
                setStep(2)
              }}
            >
              次へ
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-1 flex-col gap-6">
          <PlanetArt variant="bell" className="mx-auto text-fg" />
          <div>
            <h1 className="text-title-l">通知とホーム画面</h1>
            <p className="mt-2 text-body-m text-fg2">通知の許可は、最初のメッセージを送ったあとなど、必要になったときにお願いします（ZS-NOTIF-03）。</p>
          </div>
          {!isStandalone() && (
            <div className="card space-y-2 p-4">
              <p className="flex items-center gap-2 text-body-m font-bold">
                <Bell className="size-4 text-aurora" /> ホーム画面に追加すると通知が届きます
              </p>
              {isIos() ? (
                <ol className="list-decimal space-y-1 pl-5 text-body-m text-fg2">
                  <li>
                    Safari の下にある共有ボタン <Share className="inline size-4" /> をタップ
                  </li>
                  <li>「ホーム画面に追加」を選ぶ</li>
                  <li>ホーム画面の zenospace から開く</li>
                </ol>
              ) : (
                <p className="text-body-m text-fg2">ブラウザのメニューから「アプリをインストール」を選んでください。</p>
              )}
            </div>
          )}
          <div className="mt-auto">
            <Button variant="signature" size="lg" block onClick={finish}>
              はじめる
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
