/**
 * 送信の待ち行列（ZS-CHAT-17 / 15.4）。
 * 圏外で送ったメッセージを端末に保存し、接続回復時に順番どおり自動送信する。
 * client_id が一意なので、同じメッセージが二重に登録されることはない。
 * （本番は IndexedDB + Background Sync。Safari は次に開いたときに送る）
 */
import { api } from './api'
import type { SendInput } from './api/mock/chat'

export interface OutboxItem {
  roomId: string
  input: SendInput
  status: 'pending' | 'sending' | 'failed'
  error?: string
  createdAt: string
}

const KEY = 'zenospace:outbox'
const listeners = new Set<() => void>()
let items: OutboxItem[] = load()

function load(): OutboxItem[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as OutboxItem[]).map((i) => (i.status === 'sending' ? { ...i, status: 'pending' } : i))
  } catch {
    return []
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* noop */
  }
  for (const l of listeners) l()
}

export const outbox = {
  list(roomId: string): OutboxItem[] {
    return items.filter((i) => i.roomId === roomId)
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** 送信する。オフラインなら待ち行列に入れて、つながったら送る */
  async send(roomId: string, input: SendInput): Promise<void> {
    items.push({ roomId, input, status: 'pending', createdAt: new Date().toISOString() })
    save()
    await outbox.flush()
  },
  retry(clientId: string) {
    items = items.map((i) => (i.input.clientId === clientId ? { ...i, status: 'pending', error: undefined } : i))
    save()
    void outbox.flush()
  },
  discard(clientId: string) {
    items = items.filter((i) => i.input.clientId !== clientId)
    save()
  },
  flushing: false,
  async flush(): Promise<void> {
    if (outbox.flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return
    outbox.flushing = true
    try {
      // 順番どおりに1件ずつ送る
      for (const item of [...items]) {
        if (item.status !== 'pending') continue
        item.status = 'sending'
        save()
        try {
          await api.chat.send(item.roomId, item.input)
          items = items.filter((i) => i.input.clientId !== item.input.clientId)
        } catch (e) {
          item.status = 'failed'
          item.error = e instanceof Error ? e.message : String(e)
        }
        save()
      }
    } finally {
      outbox.flushing = false
    }
  },
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void outbox.flush())
}
