import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useSync } from '@/hooks/useLive'
import { Button, Sheet } from '@/components/ui/primitives'

/** ZS-AUTH-06 規約改定時は再同意を求める */
export function ReconsentGate() {
  const needs = useSync(() => api.auth.needsReconsent())
  const [busy, setBusy] = useState(false)
  if (!needs) return null
  return (
    <Sheet
      open
      onClose={() => {}}
      title="利用規約が改定されました"
      size="sm"
      footer={
        <Button block loading={busy} onClick={async () => (setBusy(true), await api.auth.agreeLatestTerms(), setBusy(false))}>
          同意して続ける
        </Button>
      }
    >
      <p className="text-body-m text-fg2">
        <Link to="/legal/terms" className="text-brand-text underline">
          利用規約
        </Link>
        と
        <Link to="/legal/privacy" className="text-brand-text underline">
          プライバシーポリシー
        </Link>
        を改定しました。内容を確認し、同意のうえご利用ください。
      </p>
    </Sheet>
  )
}
