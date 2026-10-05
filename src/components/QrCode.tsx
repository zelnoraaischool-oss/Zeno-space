import { useEffect, useState } from 'react'
import QR from 'qrcode'

export function QrCode({ value, size = 200, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QR.toDataURL(value, { width: size * 2, margin: 1, color: { dark: '#17322A', light: '#FFFFFF' } })
      .then((u) => alive && setSrc(u))
      .catch(() => setSrc(null))
    return () => {
      alive = false
    }
  }, [value, size])
  return src ? (
    <img src={src} width={size} height={size} alt="QRコード" className={className ?? 'rounded-[12px] bg-white p-2'} />
  ) : (
    <div style={{ width: size, height: size }} className="skeleton rounded-[12px]" />
  )
}

export async function qrDataUrl(value: string): Promise<string> {
  return QR.toDataURL(value, { width: 600, margin: 2 })
}
