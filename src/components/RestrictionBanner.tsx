import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { useSync } from '@/hooks/useLive'
import { RESTRICTION_INFO, restrictionMessage } from '@/lib/restrictions'

/** 利用制限中は理由のバナーが上から降りる（12.2 / ZS-ADM-02） */
export function RestrictionBanner() {
  const list = useSync(() => api.users.myRestrictions()).filter((r) => r.kind !== 'warning')
  if (!list.length) return null
  const r = list[0]
  return (
    <div className="anim-drop border-b border-warning/40 bg-warning/10 px-4 py-2.5" role="alert">
      <div className="mx-auto flex max-w-[1440px] items-start gap-2 text-body-m">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" strokeWidth={1.75} />
        <p className="flex-1">
          <span className="font-bold">{RESTRICTION_INFO[r.kind].label}</span>：{restrictionMessage(r)}
        </p>
        <Link to="/restricted" className="shrink-0 text-label text-brand-text underline">
          詳細
        </Link>
      </div>
    </div>
  )
}
