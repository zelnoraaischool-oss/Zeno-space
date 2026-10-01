import type { Restriction, RestrictionKind } from './types'
import { formatDateTime } from './format'

/** 10.1 利用制限の種類 */
export const RESTRICTION_INFO: Record<
  RestrictionKind,
  { label: string; stops: string; continues: string; use: string; severity: 'normal' | 'warning' | 'danger' }
> = {
  warning: {
    label: '警告',
    stops: 'なし（公式アカウントから警告文が届く）',
    continues: 'すべて',
    use: '軽微な違反の初回',
    severity: 'normal',
  },
  chat_send: {
    label: 'チャット送信停止',
    stops: 'メッセージ送信、リアクション、グループ作成と招待',
    continues: 'トークの閲覧、作品の閲覧と投稿',
    use: '迷惑メッセージ、暴言',
    severity: 'warning',
  },
  new_talk: {
    label: '新規トーク開始の停止',
    stops: '友だち以外との新しいトーク開始、友だち追加',
    continues: '既存トークでの送受信',
    use: '勧誘やスパムの疑い',
    severity: 'warning',
  },
  chat_all: {
    label: 'チャット利用停止',
    stops: 'トークの閲覧と送信（公式アカウントとのトークは除く）',
    continues: '作品の閲覧',
    use: '重大な違反の調査中',
    severity: 'warning',
  },
  post: {
    label: '作品投稿停止',
    stops: '作品の投稿と編集',
    continues: 'チャット',
    use: '不適切な作品',
    severity: 'warning',
  },
  freeze: {
    label: 'アカウント凍結',
    stops: 'ログイン（ログイン画面に理由と異議申し立てフォームを表示）',
    continues: 'なし',
    use: '重大な違反',
    severity: 'danger',
  },
  ban: {
    label: '永久停止（BAN）',
    stops: 'ログイン、同じメールアドレスと認証IDでの再登録',
    continues: 'なし',
    use: '悪質な違反の繰り返し',
    severity: 'danger',
  },
}

export function isActiveRestriction(r: Restriction, now = Date.now()): boolean {
  if (r.liftedAt) return false
  if (new Date(r.startsAt).getTime() > now) return false
  if (r.endsAt && new Date(r.endsAt).getTime() <= now) return false
  return true
}

export interface Capabilities {
  canLogin: boolean
  canSendMessage: boolean
  canReact: boolean
  canCreateGroup: boolean
  canStartNewTalk: boolean
  canAddFriend: boolean
  canViewTalks: boolean
  canPostWork: boolean
}

/**
 * 有効な制限から「できること」を求める。
 * 同じ判定を DB 側の has_restriction() と RLS が行う（ZS-ADM-03）。ここは画面表示用。
 */
export function capabilities(restrictions: Restriction[], now = Date.now()): Capabilities {
  const active = new Set(restrictions.filter((r) => isActiveRestriction(r, now)).map((r) => r.kind))
  const locked = active.has('freeze') || active.has('ban')
  const chatAll = active.has('chat_all')
  const chatSend = active.has('chat_send') || chatAll
  return {
    canLogin: !locked,
    canSendMessage: !locked && !chatSend,
    canReact: !locked && !chatSend,
    canCreateGroup: !locked && !chatSend,
    canStartNewTalk: !locked && !chatSend && !active.has('new_talk'),
    canAddFriend: !locked && !active.has('new_talk'),
    canViewTalks: !locked && !chatAll,
    canPostWork: !locked && !active.has('post'),
  }
}

/** 公式アカウントとのトークは chat_all でも使える */
export function canSendInRoom(restrictions: Restriction[], isOfficialRoom: boolean, now = Date.now()) {
  const caps = capabilities(restrictions, now)
  if (isOfficialRoom) return caps.canLogin
  return caps.canSendMessage
}

export function activeRestrictions(restrictions: Restriction[], now = Date.now()) {
  return restrictions.filter((r) => isActiveRestriction(r, now))
}

/** 15.3 の文面 */
export function restrictionMessage(r: Restriction): string {
  const until = r.endsAt ? `${formatDateTime(r.endsAt)}まで` : '無期限で'
  switch (r.kind) {
    case 'chat_send':
      return `利用規約に反する送信が確認されたため、チャットの送信を${until}制限しています。トークの閲覧と作品の投稿は引き続き利用できます`
    case 'new_talk':
      return `友だち以外との新しいトークの開始と友だち追加を${until}制限しています。既存のトークは引き続き利用できます`
    case 'chat_all':
      return `確認のため、トークの利用を${until}停止しています。公式アカウントとのトークと作品の閲覧は利用できます`
    case 'post':
      return `作品の投稿と編集を${until}制限しています。チャットは引き続き利用できます`
    case 'freeze':
      return `利用規約に反する行為が確認されたため、アカウントを${until}凍結しています`
    case 'ban':
      return '利用規約に反する行為が繰り返し確認されたため、アカウントを永久に停止しました'
    default:
      return r.userMessage
  }
}

export const DURATION_PRESETS: { label: string; ms: number | null }[] = [
  { label: '1時間', ms: 3600_000 },
  { label: '24時間', ms: 86_400_000 },
  { label: '3日', ms: 3 * 86_400_000 },
  { label: '7日', ms: 7 * 86_400_000 },
  { label: '30日', ms: 30 * 86_400_000 },
  { label: '無期限', ms: null },
]
