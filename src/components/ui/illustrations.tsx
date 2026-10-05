import { useId } from 'react'
import { cn } from '@/lib/cn'

/** 惑星・軌道・星の線画（11.4）。空状態とオンボーディングに使う */
export function PlanetArt({ className, variant = 'planet' }: { className?: string; variant?: 'planet' | 'chat' | 'search' | 'bell' | 'news' | 'post' }) {
  // 非表示の要素内の id を参照するとグラデーションが消えるため、インスタンスごとに一意にする
  const g = useId()
  return (
    <svg viewBox="0 0 160 120" className={cn('h-28 w-auto', className)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--signature-from)" />
          <stop offset="1" stopColor="var(--signature-to)" />
        </linearGradient>
      </defs>
      <circle cx="80" cy="60" r="26" stroke={`url(#${g})`} strokeWidth={2} />
      <ellipse cx="80" cy="60" rx="52" ry="13" transform="rotate(-14 80 60)" className="text-fg2" opacity={0.6} />
      {variant === 'chat' && <path d="M68 54h24M68 62h16" stroke={`url(#${g})`} strokeWidth={2} />}
      {variant === 'search' && <path d="M74 54a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M85 60l6 6" stroke={`url(#${g})`} strokeWidth={2} />}
      {variant === 'bell' && <path d="M72 66h16M74 66v-8a6 6 0 0 1 12 0v8M78 70h4" stroke={`url(#${g})`} strokeWidth={2} />}
      {variant === 'news' && <path d="M70 52h20v16H70zM73 57h14M73 62h9" stroke={`url(#${g})`} strokeWidth={2} />}
      {variant === 'post' && <path d="M80 50v20M70 60h20" stroke={`url(#${g})`} strokeWidth={2} />}
      <g className="text-fg2" opacity={0.8}>
        <path d="M22 22l2 4l4 2l-4 2l-2 4l-2 -4l-4 -2l4 -2z" />
        <circle cx="136" cy="24" r="1.5" />
        <circle cx="140" cy="96" r="1" />
        <circle cx="24" cy="94" r="1.2" />
        <path d="M130 70l1.5 3l3 1.5l-3 1.5l-1.5 3l-1.5 -3l-3 -1.5l3 -1.5z" />
      </g>
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  const g = useId()
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <defs>
          <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--signature-from)" />
            <stop offset="1" stopColor="var(--signature-to)" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="8" fill={`url(#${g})`} />
        <ellipse cx="16" cy="16" rx="14" ry="5" fill="none" stroke={`url(#${g})`} strokeWidth="1.6" transform="rotate(-20 16 16)" />
      </svg>
      <span className="text-[19px]">
        zeno<span className="text-signature">space</span>
      </span>
    </span>
  )
}
