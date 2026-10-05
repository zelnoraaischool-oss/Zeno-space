/** 15.4 PWA の補助 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

const LATER_KEY = 'zenospace:install-later'

/** iPhone の追加案内は「後で」を選んだら14日間出さない */
export function shouldShowInstallGuide(): boolean {
  if (isStandalone()) return false
  try {
    const t = Number(localStorage.getItem(LATER_KEY) ?? 0)
    return Date.now() - t > 14 * 86400_000
  } catch {
    return true
  }
}
export function postponeInstallGuide() {
  try {
    localStorage.setItem(LATER_KEY, String(Date.now()))
  } catch {
    /* noop */
  }
}

/**
 * ZS-NOTIF-03 通知の許可：理由を説明する画面を挟んでから、利用者のタップを起点に求める。
 * 本番は VAPID 公開鍵で pushManager.subscribe し、購読を保存する。
 */
export async function requestPushPermission(): Promise<PushSubscriptionJSON | null> {
  if (typeof Notification === 'undefined') return null
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return null
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!key || !('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  return sub.toJSON()
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const ASKED_KEY = 'zenospace:push-asked'
export function pushAskedAlready(): boolean {
  try {
    return !!localStorage.getItem(ASKED_KEY) || (typeof Notification !== 'undefined' && Notification.permission !== 'default')
  } catch {
    return true
  }
}
export function markPushAsked() {
  try {
    localStorage.setItem(ASKED_KEY, '1')
  } catch {
    /* noop */
  }
}
