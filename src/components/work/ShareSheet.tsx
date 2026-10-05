import { useState } from 'react'
import { Copy, MessageCircle, QrCode as QrIcon } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useLive } from '@/hooks/useLive'
import { useMe } from '@/app/session'
import { Avatar, Button, Sheet } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { QrCode } from '@/components/QrCode'
import { uuid } from '@/lib/ids'
import type { Work } from '@/lib/types'

/** ZS-WORK-17 共有：URLコピー、X、QRコード、トーク */
export function ShareSheet({ open, onClose, work }: { open: boolean; onClose: () => void; work: Work }) {
  const [mode, setMode] = useState<'menu' | 'qr' | 'talk'>('menu')
  const toast = useToast()
  const me = useMe()
  const url = `${location.origin}/works/${work.id}`
  const close = () => {
    onClose()
    setTimeout(() => setMode('menu'), 300)
  }
  return (
    <Sheet open={open} onClose={close} title="共有" size="sm">
      {mode === 'menu' && (
        <div className="grid grid-cols-2 gap-2">
          <ShareBtn
            icon={<Copy className="size-5" />}
            label="URLをコピー"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url)
                toast({ text: 'URLをコピーしました', tone: 'success' })
              } catch {
                toast({ text: url })
              }
              close()
            }}
          />
          <ShareBtn
            icon={<span className="text-[18px] font-bold">𝕏</span>}
            label="Xで共有"
            onClick={() => {
              window.open(
                `https://twitter.com/intent/tweet?text=${encodeURIComponent(work.title)}&url=${encodeURIComponent(url)}`,
                '_blank',
                'noopener,noreferrer',
              )
              close()
            }}
          />
          <ShareBtn icon={<QrIcon className="size-5" />} label="QRコード" onClick={() => setMode('qr')} />
          {me && <ShareBtn icon={<MessageCircle className="size-5" />} label="トークに送る" onClick={() => setMode('talk')} />}
        </div>
      )}
      {mode === 'qr' && (
        <div className="flex flex-col items-center gap-3 py-2">
          <QrCode value={url} size={220} />
          <p className="text-center text-caption text-fg2">{work.title}</p>
        </div>
      )}
      {mode === 'talk' && <TalkPicker work={work} onDone={close} />}
    </Sheet>
  )
}

function ShareBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card flex min-h-20 flex-col items-center justify-center gap-2 text-label hover:bg-elevated">
      {icon}
      {label}
    </button>
  )
}

function TalkPicker({ work, onDone }: { work: Work; onDone: () => void }) {
  const { data } = useLive(() => api.chat.listRooms('all'), [])
  const toast = useToast()
  return (
    <ul className="space-y-1">
      {data
        ?.filter((r) => r.room.kind !== 'official')
        .map((r) => (
          <li key={r.room.id}>
            <button
              className="flex min-h-14 w-full items-center gap-3 rounded-[12px] px-2 text-left hover:bg-surface"
              onClick={async () => {
                try {
                  await api.chat.send(r.room.id, { kind: 'work', body: '', meta: { workId: work.id }, clientId: uuid() })
                  toast({ text: `${r.title}に送りました`, tone: 'success' })
                  onDone()
                } catch (e) {
                  toast({ text: errorMessage(e), tone: 'error' })
                }
              }}
            >
              <Avatar name={r.title} color={r.peer?.avatarColor ?? r.room.iconColor} url={r.peer?.avatarUrl} size={40} />
              <span className="truncate text-body-m">{r.title}</span>
            </button>
          </li>
        ))}
      {data && data.length <= 1 && <p className="py-6 text-center text-body-m text-fg2">送れるトークがありません</p>}
      <li className="pt-2">
        <Button variant="ghost" block onClick={onDone}>
          キャンセル
        </Button>
      </li>
    </ul>
  )
}
