/**
 * デモ用：モックの相手が既読を付けて返信する。Supabase 接続後は削除する。
 */
import { db, commit } from './core'
import { nextMessageId } from '../../mock/db'
import type { Message, Profile, Room } from '../../types'
import { uuid } from '../../ids'

const enabled = import.meta.env.VITE_MOCK_BOTS !== 'false' && import.meta.env.MODE !== 'test'

const REPLIES = [
  'ありがとうございます！確認しますね。',
  'なるほど、詳しく教えてください😊',
  'いいですね！ぜひ進めましょう。',
  '承知しました。少しお時間ください🙏',
]

export function simulatePeer(room: Room, sender: Profile, m: Message) {
  if (!enabled || (room.kind !== 'direct' && room.kind !== 'inquiry')) return
  const d = db()
  const peer = d.roomMembers.find((x) => x.roomId === room.id && x.userId !== sender.id)
  if (!peer || peer.state !== 'active') return
  // 既読（1.5秒後）
  setTimeout(() => {
    peer.lastReadAt = new Date().toISOString()
    commit()
  }, 1500)
  // 3通に1回くらい返信する
  if (m.id % 3 !== 0 && room.kind !== 'inquiry') return
  setTimeout(() => {
    const at = new Date().toISOString()
    const reply: Message = {
      id: nextMessageId(),
      roomId: room.id,
      senderId: peer.userId,
      kind: 'text',
      body: REPLIES[m.id % REPLIES.length],
      replyToId: null,
      meta: {},
      clientId: uuid(),
      createdAt: at,
      unsentAt: null,
    }
    d.messages.push(reply)
    room.lastMessageAt = at
    room.lastMessagePreview = reply.body
    peer.lastReadAt = at
    const inq = d.inquiries.find((i) => i.roomId === room.id)
    if (inq && inq.toUser === peer.userId && !inq.firstReplyAt) inq.firstReplyAt = at
    commit()
  }, 4000)
}
