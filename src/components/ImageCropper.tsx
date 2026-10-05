import { useEffect, useRef, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { Button, Sheet } from '@/components/ui/primitives'

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 切り抜きと拡大縮小（ZS-PROF-06 / ZS-WORK-03）。
 * 枠の中で画像をドラッグして位置を決め、スライダーで拡大する。結果は元画像のピクセル座標。
 */
export function ImageCropper({
  file,
  aspect,
  round,
  onCancel,
  onDone,
  title = '切り抜き',
}: {
  file: File | null
  aspect: number
  round?: boolean
  onCancel: () => void
  onDone: (crop: CropRect) => void
  title?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    if (!file) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    setZoom(1)
    setOff({ x: 0, y: 0 })
    const img = new Image()
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = u
    return () => URL.revokeObjectURL(u)
  }, [file])

  const FW = 320
  const FH = FW / aspect
  // 枠を覆う最小倍率
  const base = nat ? Math.max(FW / nat.w, FH / nat.h) : 1
  const scale = base * zoom
  const dispW = nat ? nat.w * scale : 0
  const dispH = nat ? nat.h * scale : 0
  const clamp = (o: { x: number; y: number }) => ({
    x: Math.min(0, Math.max(FW - dispW, o.x)),
    y: Math.min(0, Math.max(FH - dispH, o.y)),
  })
  useEffect(() => {
    if (nat) setOff((o) => clamp(o.x === 0 && o.y === 0 ? { x: (FW - dispW) / 2, y: (FH - dispH) / 2 } : o))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat, zoom])

  return (
    <Sheet
      open={!!file}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            block
            disabled={!nat}
            onClick={() =>
              nat && onDone({ x: Math.round(-off.x / scale), y: Math.round(-off.y / scale), w: Math.round(FW / scale), h: Math.round(FH / scale) })
            }
          >
            決定
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          ref={frame}
          className="relative touch-none overflow-hidden bg-black"
          style={{ width: FW, height: FH, borderRadius: round ? 9999 : 12 }}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            setOff(clamp({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }))
          }}
          onPointerUp={() => (drag.current = null)}
        >
          {url && nat && (
            <img
              src={url}
              alt=""
              draggable={false}
              className="absolute max-w-none cursor-grab select-none"
              style={{ width: dispW, height: dispH, left: off.x, top: off.y }}
            />
          )}
        </div>
        <label className="flex w-full items-center gap-3">
          <ZoomIn className="size-5 text-fg2" aria-hidden />
          <span className="sr-only">拡大</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-[var(--brand-primary)]"
          />
        </label>
        <p className="text-caption text-fg2">ドラッグで位置を調整できます。位置情報などの撮影情報は自動で削除されます。</p>
      </div>
    </Sheet>
  )
}
