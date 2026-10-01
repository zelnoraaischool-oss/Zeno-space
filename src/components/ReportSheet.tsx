import { useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { REPORT_REASONS } from '@/lib/constants'
import type { ReportTarget } from '@/lib/types'
import { Button, Sheet, TextArea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'

/** U-22 通報：理由の選択、提供するメッセージの確認、完了 */
export function ReportSheet({
  open,
  onClose,
  targetType,
  targetId,
  roomId,
  targetLabel,
}: {
  open: boolean
  onClose: () => void
  targetType: ReportTarget
  targetId: string
  roomId?: string
  targetLabel: string
}) {
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [share, setShare] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const toast = useToast()
  const close = () => {
    onClose()
    setTimeout(() => {
      setDone(false)
      setReason('')
      setDetail('')
    }, 300)
  }
  return (
    <Sheet
      open={open}
      onClose={close}
      title={done ? '通報を受け付けました' : `${targetLabel}を通報`}
      footer={
        done ? (
          <Button block onClick={close}>
            閉じる
          </Button>
        ) : (
          <Button
            variant="danger"
            block
            loading={busy}
            disabled={!reason}
            onClick={async () => {
              setBusy(true)
              try {
                await api.reports.create({ targetType, targetId, reason, detail, shareMessages: share, roomId })
                setDone(true)
              } catch (e) {
                toast({ text: errorMessage(e), tone: 'error' })
              } finally {
                setBusy(false)
              }
            }}
          >
            通報する
          </Button>
        )
      }
    >
      {done ? (
        <p className="text-body-m text-fg2">通報を受け付けました。内容を確認し、必要な対応を行います。対応が終わったらお知らせします。</p>
      ) : (
        <div className="space-y-4">
          <fieldset className="space-y-1">
            <legend className="mb-2 text-label">理由を選んでください</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-3 rounded-[10px] px-2 hover:bg-surface">
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="size-5 accent-[var(--brand-primary)]"
                />
                <span className="text-body-m">{r}</span>
              </label>
            ))}
          </fieldset>
          <TextArea label="詳しい状況（任意）" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={500} />
          {targetType === 'message' && (
            <label className="flex items-start gap-3 rounded-[12px] bg-surface p-3 text-body-m">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1 size-5 accent-[var(--brand-primary)]" />
              <span>
                このメッセージと前後5件を運営に提供することに同意します
                <span className="block text-caption text-fg2">運営は通常トークの内容を見ません。同意した範囲だけを確認に使います。</span>
              </span>
            </label>
          )}
        </div>
      )}
    </Sheet>
  )
}
