import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { useSync } from '@/hooks/useLive'
import { PageHeader } from '@/components/layout/AppLayout'
import { Badge, Button, TextArea } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { RESTRICTION_INFO, restrictionMessage } from '@/lib/restrictions'
import { formatDateTime } from '@/lib/format'

/** U-23 利用制限のお知らせ：制限の種類、理由、期限、異議申し立て（ZS-ADM-07） */
export default function Restricted() {
  const list = useSync(() => api.users.myRestrictions())
  const appeals = useSync(() => api.users.myAppeals())
  return (
    <>
      <PageHeader title="利用制限" back actions={<span />} />
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {list.length === 0 && <EmptyState title="現在、利用制限はありません" />}
        {list.map((r) => {
          const appeal = appeals.find((a) => a.restrictionId === r.id)
          const info = RESTRICTION_INFO[r.kind]
          return (
            <section key={r.id} className="card space-y-3 border-warning/40 p-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-warning" />
                <h2 className="text-title-m">{info.label}</h2>
              </div>
              <p className="text-body-m">{restrictionMessage(r)}</p>
              <dl className="grid grid-cols-[100px_1fr] gap-y-1 text-body-m">
                <dt className="text-fg2">理由</dt>
                <dd>{r.reasonCategory}</dd>
                <dt className="text-fg2">止まること</dt>
                <dd>{info.stops}</dd>
                <dt className="text-fg2">できること</dt>
                <dd>{info.continues}</dd>
                <dt className="text-fg2">解除予定</dt>
                <dd>{r.endsAt ? formatDateTime(r.endsAt) : '無期限'}</dd>
              </dl>
              {r.userMessage && <p className="rounded-[12px] bg-surface p-3 text-body-m">{r.userMessage}</p>}
              {appeal ? (
                <p className="text-body-m">
                  異議申し立て：
                  <Badge tone={appeal.status === 'lifted' ? 'success' : appeal.status === 'kept' ? 'danger' : 'warning'}>
                    {{ open: '受付済み', reviewing: '再審中', lifted: '解除', kept: '維持' }[appeal.status]}
                  </Badge>
                  {appeal.result && <span className="mt-1 block text-fg2">{appeal.result}</span>}
                </p>
              ) : (
                <AppealForm restrictionId={r.id} />
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}

function AppealForm({ restrictionId }: { restrictionId: string }) {
  const [body, setBody] = useState('')
  const toast = useToast()
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api.users.submitAppeal(restrictionId, body)
          toast({ text: '異議申し立てを受け付けました。結果は公式アカウントからお知らせします', tone: 'success' })
        } catch (err) {
          toast({ text: errorMessage(err), tone: 'error' })
        }
      }}
    >
      <TextArea label="異議申し立て" value={body} onChange={(e) => setBody(e.target.value)} placeholder="状況を具体的に教えてください" required />
      <Button type="submit" variant="secondary">
        申し立てを送る
      </Button>
    </form>
  )
}
