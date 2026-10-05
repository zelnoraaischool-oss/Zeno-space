/**
 * モック API で、20.2 受け入れ基準の主要シナリオをデータ層で確かめる。
 * Supabase 接続後は同じシナリオを supabase/tests（pgTAP）と e2e（Playwright）で確かめる。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../api'
import { resetDb, db } from '../mock/db'
import { setAdminSession } from '../api/mock/core'
import { uuid } from '../ids'

async function login(email: string) {
  const r = await api.auth.signInWithProvider('google', email)
  if (r.status !== 'signed_in') throw new Error(`login failed: ${r.status}`)
  return r.userId
}

async function loginAdmin() {
  const id = await login('kura@example.com')
  await api.auth.verifyAdminTotp('123456')
  return id
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetDb()
})

describe('1人1アカウント（20.2）', () => {
  it('ドットや + だけが違う Gmail で新規登録すると、既存アカウントへの連携を案内する', async () => {
    const r = await api.auth.signInWithProvider('github', 'm.i.o.design+new@gmail.com')
    expect(r.status).toBe('link_suggested')
  })
  it('新しいメールアドレスなら、規約同意と生年月を入力して登録できる。公式アカウントが自動で追加される', async () => {
    const r = await api.auth.signInWithProvider('google', 'newcomer@example.com', '新人')
    expect(r.status).toBe('new_user')
    if (r.status !== 'new_user') return
    await expect(api.auth.completeSignUp({ pending: r.pending, birthYm: '2015-01', agreed: true })).rejects.toThrow('18歳以上')
    const done = await api.auth.completeSignUp({ pending: r.pending, birthYm: '1990-05', agreed: true })
    expect(done.status).toBe('signed_in')
    const rooms = await api.chat.listRooms('official')
    expect(rooms).toHaveLength(1)
  })
  it('同じ端末で別のアカウントを登録すると「重複の疑い」に並ぶ', async () => {
    await login('kura@example.com')
    await api.auth.signOut()
    await login('mio.design@gmail.com')
    const d = db().dupSuspicions.find((s) => s.userIds.length >= 2 && s.deviceHash.startsWith('dev-'))
    expect(d).toBeTruthy()
  })
})

describe('チャット送信停止（20.2）', () => {
  it('制限すると送信できず、公式アカウントから通知が届き、監査ログに残る。期限が来ると解除される', async () => {
    const mio = db().profiles.find((p) => p.handle === 'mio_design')!
    await loginAdmin()
    const [rid] = await api.admin.restrict({
      userIds: [mio.id],
      kind: 'chat_send',
      durationMs: 86400_000,
      reasonCategory: 'スパム',
      userMessage: '',
      internalNote: '',
    })
    expect(db().auditLogs.some((l) => l.action === 'restriction.create.chat_send')).toBe(true)
    await api.auth.signOut()

    await login('mio.design@gmail.com')
    const group = (await api.chat.listRooms('group'))[0]
    await expect(api.chat.send(group.room.id, { body: 'test', clientId: uuid() })).rejects.toThrow('制限')
    // 公式アカウントへの問い合わせは送れる
    const official = api.chat.officialRoomId()!
    await expect(api.chat.send(official, { body: '異議があります', clientId: uuid() })).resolves.toBeTruthy()
    const msgs = await api.chat.listMessages(official, { limit: 100 })
    expect(msgs.messages.some((m) => m.body.startsWith('【チャット送信停止】'))).toBe(true)

    // 期限切れ → 自動解除
    const { runJobs } = await import('../api/mock/jobs')
    db().restrictions.find((x) => x.id === rid)!.endsAt = new Date(Date.now() - 1000).toISOString()
    runJobs()
    await expect(api.chat.send(group.room.id, { body: '解除後', clientId: uuid() })).resolves.toBeTruthy()
  })
})

describe('一斉配信（20.2）', () => {
  it('本文は1件だけ保存され、全員配信では宛先の行が増えない。取り消すと全員の画面から消える', async () => {
    await loginAdmin()
    setAdminSession(api.users.me()!.id)
    const b = await api.admin.saveBroadcast({ title: 'テスト配信', bubbles: [{ type: 'text', text: '{name}さん、こんにちは' }], pushText: 'お知らせ' })
    const before = db().broadcastRecipients.length
    await api.admin.approveAndSend(b.id)
    expect(db().broadcasts.filter((x) => x.title === 'テスト配信')).toHaveLength(1)
    expect(db().broadcastRecipients.length).toBe(before)
    await api.auth.signOut()

    await login('taku.dev@gmail.com')
    const official = api.chat.officialRoomId()!
    let msgs = await api.chat.listMessages(official, { limit: 100 })
    expect(msgs.messages.some((m) => m.body === 'たくさん、こんにちは')).toBe(true)
    await api.auth.signOut()

    await loginAdmin()
    await api.admin.cancelBroadcast(b.id)
    await api.auth.signOut()
    await login('taku.dev@gmail.com')
    msgs = await api.chat.listMessages(official, { limit: 100 })
    expect(msgs.messages.some((m) => m.body === 'たくさん、こんにちは')).toBe(false)
  })
})

describe('問い合わせ・いいね・既読', () => {
  it('問い合わせトークは作品カード付きで始まり、制作者の「問い合わせ」に分類される', async () => {
    await login('taku.dev@gmail.com')
    const work = db().works.find((w) => w.title === '自家焙煎カフェ「灯」LP')!
    const roomId = await api.chat.openInquiry(work.id)
    const msgs = await api.chat.listMessages(roomId)
    expect(msgs.messages[0].kind).toBe('work')
    await api.auth.signOut()
    await login('mio.design@gmail.com')
    const inquiries = await api.chat.listRooms('inquiry')
    expect(inquiries.some((r) => r.room.id === roomId)).toBe(true)
  })
  it('受付停止中の制作者には問い合わせできない', async () => {
    await login('taku.dev@gmail.com')
    const ren = db().profiles.find((p) => p.handle === 'ren_movie')!
    const work = db().works.find((w) => w.ownerId === ren.id)!
    await expect(api.chat.openInquiry(work.id)).rejects.toThrow('受け付けていません')
  })
  it('いいねは数に反映され、制作者に通知される', async () => {
    await login('taku.dev@gmail.com')
    const work = db().works.find((w) => w.title === 'ヘアサロン予約LP')!
    const before = work.likeCount
    await api.works.setLike(work.id, true)
    expect(work.likeCount).toBe(before + 1)
    const mio = db().profiles.find((p) => p.handle === 'mio_design')!
    expect(db().notifications.some((n) => n.userId === mio.id && n.kind === 'like')).toBe(true)
  })
  it('グループで3人がトークを開くと「既読 3」', async () => {
    await login('kura@example.com')
    const group = (await api.chat.listRooms('group'))[0]
    const m = await api.chat.send(group.room.id, { body: '既読テスト', clientId: uuid() })
    await api.auth.signOut()
    for (const email of ['mio.design@gmail.com', 'taku.dev@gmail.com', 'hana.illust@gmail.com']) {
      await login(email)
      await api.chat.markRead(group.room.id)
      await api.auth.signOut()
    }
    expect(api.chat.readCount(group.room.id, m)).toBe(3)
  })
  it('同じ client_id の再送は1回だけ登録される（オフライン送信）', async () => {
    await login('kura@example.com')
    const group = (await api.chat.listRooms('group'))[0]
    const clientId = uuid()
    await api.chat.send(group.room.id, { body: '一度だけ', clientId })
    await api.chat.send(group.room.id, { body: '一度だけ', clientId })
    expect(db().messages.filter((m) => m.clientId === clientId)).toHaveLength(1)
  })
})

describe('メッセージリクエストとブロック', () => {
  it('友だちでない相手からの最初のメッセージはリクエストに入り、ブロック後は届かない', async () => {
    await login('hana.illust@gmail.com')
    const taku = db().profiles.find((p) => p.handle === 'taku_dev')!
    const roomId = await api.chat.openDirect(taku.id)
    await api.chat.send(roomId, { body: 'はじめまして', clientId: uuid() })
    await api.auth.signOut()
    await login('taku.dev@gmail.com')
    expect((await api.chat.listRequests()).some((r) => r.room.id === roomId)).toBe(true)
    const hana = db().profiles.find((p) => p.handle === 'hana_illust')!
    await api.users.block(hana.id)
    await api.auth.signOut()
    await login('hana.illust@gmail.com')
    await expect(api.chat.send(roomId, { body: 'ブロック後', clientId: uuid() })).resolves.toBeTruthy()
    await api.auth.signOut()
    await login('taku.dev@gmail.com')
    const msgs = await api.chat.previewRequest(roomId).catch(() => [])
    expect(msgs.some((m) => m.body === 'ブロック後')).toBe(false)
  })
})

describe('無料枠の逼迫（20.2）', () => {
  it('DB容量が90%を超えると、画像の送信だけが止まりテキストは送れる', async () => {
    await loginAdmin()
    await api.admin.simulateUsage('db_bytes', 0.92)
    const meters = await api.admin.usage()
    expect(meters.find((m) => m.metric === 'db_bytes')!.level).toBe('warning')
    const group = (await api.chat.listRooms('group'))[0]
    await expect(api.chat.send(group.room.id, { kind: 'image', body: '', meta: { images: [] }, clientId: uuid() })).rejects.toThrow('画像の送信を一時停止')
    await expect(api.chat.send(group.room.id, { body: 'テキストは送れる', clientId: uuid() })).resolves.toBeTruthy()
  })
})

describe('AIニュース（20.2）', () => {
  it('承認後配信モードでは下書きで止まり、承認すると配信される。要約に失敗した記事は見出しと出典だけ', async () => {
    await loginAdmin()
    await api.admin.runNews({ failSummaryForDemo: true })
    const today = await api.admin.newsToday()
    expect(today.digest?.status).toBe('pending')
    expect(today.selected.every((n) => n.summaryJa === null)).toBe(true)
    db().settings.news.time = '00:00'
    const res = await api.admin.approveNews(today.digest!.id)
    expect(res).toBe('sent')
    expect(db().broadcasts.some((b) => b.kind === 'news' && b.title.includes(today.digest!.date))).toBe(true)
  })
})
