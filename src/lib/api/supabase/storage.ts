/**
 * 画像のアップロード（Supabase Storage の公開バケット media）。
 * 端末側で縮小・EXIF 除去した WebP を作り、`{ユーザーID}/{用途}/{ID}_{サイズ}.webp` に保存する。
 * 作品とトークの画像は 400px（一覧）と 1,200px（詳細）の2サイズ。
 */
import { ApiError } from '../errors'
import { processImage, type UploadedImage } from '../storage'
import { state } from './store'
import { sb } from './core'

const BUCKET = 'media'

export const storage = {
  async uploadImage(
    file: Blob,
    opts: { kind: 'work' | 'chat' | 'avatar' | 'cover'; maxMb?: number; crop?: { x: number; y: number; w: number; h: number } },
  ): Promise<UploadedImage> {
    const userId = state.userId
    if (!userId) throw new ApiError('unauthenticated', 'ログインしてください')
    const maxMb = opts.maxMb ?? state.appSettings.uploadMaxMb ?? 10
    if (file.size > maxMb * 1024 * 1024 * 2) throw new ApiError('invalid', `画像は${maxMb}MBまでです`)
    const sizes = opts.kind === 'avatar' ? [256] : opts.kind === 'cover' ? [1200] : [400, 1200]
    const { variants, dominantColor } = await processImage(file, sizes, opts.crop)
    const id = crypto.randomUUID()
    const urls: string[] = []
    for (const v of variants) {
      const label = opts.kind === 'avatar' ? 'avatar' : opts.kind === 'cover' ? 'cover' : String(v.size)
      const path = `${userId}/${opts.kind}/${id}_${label}.webp`
      const { error } = await sb().upload(BUCKET, path, v.blob, 'image/webp')
      if (error) throw new ApiError('invalid', `画像をアップロードできませんでした（${error.message}）`)
      urls.push(sb().publicUrl(BUCKET, path))
    }
    const large = variants[variants.length - 1]
    return {
      url: urls[urls.length - 1],
      thumbUrl: urls[0],
      width: large.width,
      height: large.height,
      dominantColor,
      bytes: variants.reduce((n, v) => n + v.blob.size, 0),
    }
  },
}
