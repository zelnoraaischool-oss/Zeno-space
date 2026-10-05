import { describe, expect, it } from 'vitest'
import { capabilities, canSendInRoom, isActiveRestriction, restrictionMessage } from '../restrictions'
import type { Restriction, RestrictionKind } from '../types'

const r = (kind: RestrictionKind, over: Partial<Restriction> = {}): Restriction => ({
  id: 'r1',
  userId: 'u1',
  kind,
  startsAt: new Date(Date.now() - 1000).toISOString(),
  endsAt: new Date(Date.now() + 86400_000).toISOString(),
  reasonCategory: 'スパム',
  userMessage: '',
  internalNote: '',
  createdBy: 'admin',
  liftedAt: null,
  ...over,
})

describe('利用制限（10.1）', () => {
  it('チャット送信停止：送信・リアクション・グループ作成が止まり、閲覧と作品投稿は続けられる', () => {
    const c = capabilities([r('chat_send')])
    expect(c.canSendMessage).toBe(false)
    expect(c.canReact).toBe(false)
    expect(c.canCreateGroup).toBe(false)
    expect(c.canViewTalks).toBe(true)
    expect(c.canPostWork).toBe(true)
  })
  it('新規トーク開始の停止：既存トークでは送れるが、新しいトークと友だち追加はできない', () => {
    const c = capabilities([r('new_talk')])
    expect(c.canSendMessage).toBe(true)
    expect(c.canStartNewTalk).toBe(false)
    expect(c.canAddFriend).toBe(false)
  })
  it('チャット利用停止でも公式アカウントのトークには送れる', () => {
    expect(canSendInRoom([r('chat_all')], false)).toBe(false)
    expect(canSendInRoom([r('chat_all')], true)).toBe(true)
  })
  it('凍結と永久停止はログインできない', () => {
    expect(capabilities([r('freeze')]).canLogin).toBe(false)
    expect(capabilities([r('ban', { endsAt: null })]).canLogin).toBe(false)
  })
  it('期限切れ・解除済み・開始前の制限は効かない', () => {
    expect(isActiveRestriction(r('chat_send', { endsAt: new Date(Date.now() - 1).toISOString() }))).toBe(false)
    expect(isActiveRestriction(r('chat_send', { liftedAt: new Date().toISOString() }))).toBe(false)
    expect(isActiveRestriction(r('chat_send', { startsAt: new Date(Date.now() + 60_000).toISOString() }))).toBe(false)
  })
  it('文面は解除予定日時を具体的に書く（15.3）', () => {
    const msg = restrictionMessage(r('chat_send', { endsAt: '2026-10-03T09:00:00Z' }))
    expect(msg).toContain('10月3日 18:00まで')
    expect(msg).toContain('トークの閲覧と作品の投稿は引き続き利用できます')
  })
})
