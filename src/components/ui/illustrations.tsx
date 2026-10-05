import { useMemo } from 'react'
import { cn } from '@/lib/cn'

/*
 * 11.4 イラスト：静かな室内に差す光、オリーブの枝、葉の影で統一する。
 * 色は currentColor とトークンだけで描き、ライト・ダークの両方で馴染ませる。
 */

interface Leaf {
  x: number
  y: number
  angle: number
  len: number
}

/** 枝に沿って葉を互い違いに並べる（座標は viewBox 基準） */
function sprig(seed: number, from: [number, number], to: [number, number], count: number, len: number): { stem: string; leaves: Leaf[] } {
  const [x1, y1] = from
  const [x2, y2] = to
  const cx = (x1 + x2) / 2 + (seed % 2 ? 18 : -18)
  const cy = (y1 + y2) / 2
  const stem = `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`
  const leaves: Leaf[] = []
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1)
    const x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2
    const y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2
    const dir = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI)
    const side = i % 2 ? 1 : -1
    leaves.push({ x, y, angle: dir + side * (38 + ((seed * 7 + i * 13) % 18)), len: len * (0.75 + ((seed + i * 5) % 5) / 10) })
  }
  return { stem, leaves }
}

function LeafShape({ l, fill }: { l: Leaf; fill?: boolean }) {
  const w = l.len * 0.22
  return (
    <path
      d={`M0 0 C ${l.len * 0.3} ${-w} ${l.len * 0.75} ${-w} ${l.len} 0 C ${l.len * 0.75} ${w} ${l.len * 0.3} ${w} 0 0 Z`}
      transform={`translate(${l.x} ${l.y}) rotate(${l.angle})`}
      fill={fill ? 'currentColor' : 'none'}
    />
  )
}

/** オリーブの枝（線画）。ランディング・空状態・オンボーディングに使う */
export function OliveBranch({ className, filled = false, seed = 3 }: { className?: string; filled?: boolean; seed?: number }) {
  const parts = useMemo(
    () => [
      sprig(seed, [20, 230], [190, 30], 11, 30),
      sprig(seed + 1, [92, 150], [30, 70], 6, 24),
      sprig(seed + 2, [130, 100], [220, 90], 6, 24),
    ],
    [seed],
  )
  return (
    <svg viewBox="0 0 240 240" className={className} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {parts.map((p, i) => (
        <g key={i}>
          <path d={p.stem} />
          {p.leaves.map((l, j) => (
            <LeafShape key={j} l={l} fill={filled} />
          ))}
        </g>
      ))}
    </svg>
  )
}

/**
 * 葉の影：壁に落ちた枝の影のように、ぼかした塗りの枝をゆっくり揺らす。
 * 「アニメーションを減らす」では止める（index.css）。
 */
export function LeafShadow({ className }: { className?: string }) {
  return (
    <div className={cn('leaf-shadow pointer-events-none select-none', className)} aria-hidden>
      <OliveBranch filled seed={5} className="size-full" />
    </div>
  )
}

/** 背景の環境光：窓からの光の帯と、葉の影 */
export function Ambient({ leaves = true, className }: { leaves?: boolean; className?: string }) {
  return (
    <div className={cn('ambient pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)} aria-hidden>
      <div className="light-beams absolute inset-0" />
      {leaves && (
        <>
          <LeafShadow className="absolute -left-24 top-[38%] size-[520px] -rotate-12" />
          <LeafShadow className="absolute -right-32 bottom-[-120px] size-[560px] rotate-[150deg]" />
        </>
      )}
    </div>
  )
}

type ArtVariant = 'planet' | 'chat' | 'search' | 'bell' | 'news' | 'post'

/** 空状態のイラスト：細い円（差し込む光）とオリーブの枝、中央に用途の印 */
export function PlanetArt({ className, variant = 'planet' }: { className?: string; variant?: ArtVariant }) {
  return (
    <svg viewBox="0 0 160 120" className={cn('h-28 w-auto', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="80" cy="60" r="34" className="text-brand-text" opacity={0.9} />
      <line x1="28" y1="104" x2="132" y2="104" className="text-fg2" opacity={0.5} />
      <g className="text-brand-text" strokeWidth={1.8}>
        {variant === 'chat' && <path d="M66 52h28M66 61h18M66 70l-4 8 10-6" />}
        {variant === 'search' && <path d="M73 54a8 8 0 1 0 16 0a8 8 0 1 0 -16 0M87 61l8 8" />}
        {variant === 'bell' && <path d="M70 68h20M73 68v-9a7 7 0 0 1 14 0v9M78 73h4" />}
        {variant === 'news' && <path d="M68 48h24v24H68zM72 55h16M72 61h12M72 67h8" />}
        {variant === 'post' && <path d="M80 47v26M67 60h26" />}
        {variant === 'planet' && <path d="M70 66c6-14 14-18 22-18M74 60c4 0 8 2 10 6" />}
      </g>
      <g className="text-aurora" transform="translate(98 34) scale(0.32) rotate(18)">
        <OliveBranchPaths />
      </g>
    </svg>
  )
}

function OliveBranchPaths() {
  const p = useMemo(() => sprig(2, [20, 230], [190, 30], 9, 34), [])
  return (
    <g strokeWidth={3}>
      <path d={p.stem} />
      {p.leaves.map((l, j) => (
        <LeafShape key={j} l={l} />
      ))}
    </g>
  )
}

/** ロゴ：細い軌道を持つ点（zeno）と、細身の欧文ロゴタイプ */
export function Logo({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  const lg = size === 'lg'
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-brand', className)}>
      <svg viewBox="0 0 32 32" className={lg ? 'size-11' : 'size-7'} aria-hidden>
        <circle cx="16" cy="16" r="6.5" fill="currentColor" />
        <ellipse cx="16" cy="16" rx="14" ry="5" fill="none" stroke="currentColor" strokeWidth="1.3" transform="rotate(-24 16 16)" />
        <circle cx="28.4" cy="10.6" r="1.6" className="text-aurora" fill="currentColor" />
      </svg>
      <span className={cn('font-sans tracking-[0.02em]', lg ? 'text-[34px] leading-none' : 'text-[20px] leading-none')}>
        <span className="font-semibold">zeno</span>
        <span className="font-light text-brand-text">space</span>
      </span>
    </span>
  )
}

/** 見出しの前に置く、細い線と小さな欧文ラベル（例：「PICK UP」） */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('eyebrow inline-flex items-center gap-3', className)}>
      <span className="h-px w-7 bg-current opacity-50" aria-hidden />
      {children}
    </span>
  )
}
