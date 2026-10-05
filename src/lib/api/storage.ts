/**
 * 画像の加工とアップロード（ZS-CHAT-11 / ZS-WORK-03 / ZS-PROF-06）。
 * 端末側で長辺を縮小した WebP を作り、Canvas で描き直すことで EXIF（位置情報など）を消す。
 * 本番は Edge Function `upload-url` で R2 の署名付きURL（5分）を受け取り、端末から直接 PUT する。
 */
import { ApiError } from './errors'

export interface ProcessedImage {
  size: number
  blob: Blob
  width: number
  height: number
}

export interface UploadedImage {
  url: string
  thumbUrl: string
  width: number
  height: number
  dominantColor: string
  bytes: number
}

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']

/** 先頭のバイト列で形式を判定する（拡張子や MIME を信用しない：18.3） */
export async function sniffImageType(file: Blob): Promise<string | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/heic'
  return null
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* フォールバック */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new ApiError('invalid', '画像を読み込めませんでした'))
    img.src = URL.createObjectURL(file)
  })
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ApiError('invalid', '画像を変換できませんでした'))), 'image/webp', quality),
  )
}

export async function processImage(
  file: Blob,
  sizes: number[] = [400, 1200, 2048],
  crop?: { x: number; y: number; w: number; h: number },
): Promise<{ variants: ProcessedImage[]; dominantColor: string }> {
  const type = await sniffImageType(file)
  if (!type || !ALLOWED.includes(type)) throw new ApiError('invalid', 'JPEG・PNG・WebP・GIF の画像を選んでください（SVG は使えません）')
  const bmp = await loadBitmap(file)
  const sw = crop?.w ?? bmp.width
  const sh = crop?.h ?? bmp.height
  const sx = crop?.x ?? 0
  const sy = crop?.y ?? 0
  const variants: ProcessedImage[] = []
  for (const size of sizes) {
    const scale = Math.min(1, size / Math.max(sw, sh))
    const w = Math.max(1, Math.round(sw * scale))
    const h = Math.max(1, Math.round(sh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h)
    variants.push({ size, blob: await toBlob(canvas, size <= 400 ? 0.72 : 0.82), width: w, height: h })
  }
  // 代表色（読み込み前の塗りに使う：14.1）
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const cx = c.getContext('2d')!
  cx.drawImage(bmp, sx, sy, sw, sh, 0, 0, 1, 1)
  const [r, g, b] = cx.getImageData(0, 0, 1, 1).data
  const dominantColor = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  return { variants, dominantColor }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(b)
  })
}

export const storage = {
  /**
   * 画像をアップロードして URL を返す。
   * モックは data URL を返す（R2 接続前）。本番は 3 サイズを同じキーの接尾辞（_400 / _1200 / _2048）で保存する。
   */
  async uploadImage(
    file: Blob,
    opts: { kind: 'work' | 'chat' | 'avatar' | 'cover'; maxMb?: number; crop?: { x: number; y: number; w: number; h: number } },
  ): Promise<UploadedImage> {
    const max = (opts.maxMb ?? 10) * 1024 * 1024
    if (file.size > max * 2) throw new ApiError('invalid', `画像は${opts.maxMb ?? 10}MBまでです`)
    const sizes = opts.kind === 'work' ? [400, 1200] : opts.kind === 'chat' ? [400, 1200] : opts.kind === 'avatar' ? [256] : [1200]
    const { variants, dominantColor } = await processImage(file, sizes, opts.crop)
    const large = variants[variants.length - 1]
    const small = variants[0]
    return {
      url: await blobToDataUrl(large.blob),
      thumbUrl: await blobToDataUrl(small.blob),
      width: large.width,
      height: large.height,
      dominantColor,
      bytes: variants.reduce((n, v) => n + v.blob.size, 0),
    }
  },
}
