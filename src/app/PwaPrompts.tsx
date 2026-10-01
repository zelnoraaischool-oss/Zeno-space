import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Share, PlusSquare, Smartphone } from 'lucide-react'
import { Button, Sheet } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { isIos, postponeInstallGuide, shouldShowInstallGuide } from '@/lib/pwa'
import { useMe } from './session'

/**
 * 15.4 PWA：
 * - 新しい版があれば「新しいバージョンがあります」と「更新」を出す。入力中は出さない
 * - iPhone は共有メニューからの追加手順を3枚の図で案内し、「後で」は14日間出さない
 */
export function PwaPrompts() {
  const toast = useToast()
  const me = useMe()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  useEffect(() => {
    if (!needRefresh) return
    const show = () => {
      const el = document.activeElement
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return setTimeout(show, 5000)
      toast({ text: '新しいバージョンがあります', ms: 15000, action: { label: '更新', onClick: () => void updateServiceWorker(true) } })
    }
    show()
  }, [needRefresh, toast, updateServiceWorker])

  const [guide, setGuide] = useState(false)
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!me?.onboarded || !isIos() || !shouldShowInstallGuide()) return
    const t = setTimeout(() => setGuide(true), 4000)
    return () => clearTimeout(t)
  }, [me?.onboarded])
  const steps = [
    { icon: Share, text: 'Safari の下にある共有ボタンをタップします' },
    { icon: PlusSquare, text: '「ホーム画面に追加」を選びます' },
    { icon: Smartphone, text: 'ホーム画面の zenospace から開くと、通知が届くようになります' },
  ]
  const S = steps[step]
  return (
    <Sheet
      open={guide}
      onClose={() => (setGuide(false), postponeInstallGuide())}
      title="ホーム画面に追加"
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={() => (setGuide(false), postponeInstallGuide())}>
            後で
          </Button>
          <Button block onClick={() => (step < 2 ? setStep(step + 1) : (setGuide(false), postponeInstallGuide()))}>
            {step < 2 ? '次へ' : 'わかりました'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <span className="bg-signature flex size-16 items-center justify-center rounded-[20px] text-white">
          <S.icon className="size-8" />
        </span>
        <p className="text-caption text-fg2 tabular">{step + 1}/3</p>
        <p className="text-body-l">{S.text}</p>
      </div>
    </Sheet>
  )
}
