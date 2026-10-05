import type { DB } from './db'
import type { AppSettings, Message, NewsCategory, NewsItem, NotificationKind, Profile, Room, RoomMember, UserSettings, Work, WorkType } from '../types'
import { DEFAULT_CATEGORIES, DEFAULT_TECHS, OFFICIAL_USER_ID, TERMS_VERSION } from '../constants'
import { normalizeEmail, normalizeSearch } from '../normalize'
import { jstDateKey } from '../format'
import { colorFor, coverArt, workThumb } from './art'

/** 初期データの形や見た目を変えたら上げる（端末内のデモデータを作り直す） */
export const SEED_VERSION = 2

const H = 3600_000
const D = 24 * H

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

let idc = 0
function sid(prefix: string): string {
  idc += 1
  const n = idc.toString(16).padStart(12, '0')
  return `${prefix}-0000-4000-8000-${n}`
}

export function defaultSettings(userId: string): UserSettings {
  const notify = {} as Record<NotificationKind, boolean>
  for (const k of ['message', 'mention', 'request', 'friend', 'like', 'inquiry', 'saved_search', 'broadcast', 'news', 'important'] as NotificationKind[])
    notify[k] = true
  return {
    userId,
    notify,
    quietHours: { enabled: false, start: '23:00', end: '07:00' },
    hidePushBody: false,
    theme: 'light',
    textSize: 'normal',
    reduceMotion: false,
    enterToSend: true,
  }
}

export const defaultAppSettings: AppSettings = {
  inviteOnly: false,
  sendRatePerMinute: 30,
  newUserDailyNewTalks: 10,
  groupMaxMembers: 100,
  uploadMaxMb: 10,
  maintenance: { enabled: false, until: null, message: '' },
  reportAutoHideThreshold: 3,
  broadcastDailyLimit: 2,
  broadcastApprovalRequired: true,
  news: {
    time: '07:30',
    days: 'daily',
    mode: 'approval',
    count: 5,
    minCount: 3,
    includeKeywords: ['AI', 'LLM', '生成AI'],
    excludeKeywords: ['PR', '広告'],
    provider: 'workers-ai',
  },
  heavyFeaturesPaused: false,
  termsVersion: TERMS_VERSION,
  privacyVersion: TERMS_VERSION,
}

function profile(p: Partial<Profile> & Pick<Profile, 'id' | 'handle' | 'displayName'>): Profile {
  return {
    avatarUrl: null,
    avatarColor: colorFor(p.handle),
    coverUrl: null,
    bio: '',
    skills: [],
    links: [],
    prefecture: null,
    commissionStatus: 'open',
    dmPolicy: 'everyone',
    profileVisibility: 'public',
    interests: [],
    status: 'active',
    isOfficial: false,
    birthYm: '1995-04',
    handleChangedAt: null,
    onboarded: true,
    createdAt: ago(60 * D),
    lastLoginAt: ago(2 * H),
    deletedAt: null,
    ...p,
  }
}

export function seed(): DB {
  idc = 0
  const categories = DEFAULT_CATEGORIES.map((name, i) => ({ id: sid('cat00000'), name, normalizedName: normalizeSearch(name), sortOrder: i }))
  const techs = DEFAULT_TECHS.map((name, i) => ({ id: sid('tec00000'), name, normalizedName: normalizeSearch(name), sortOrder: i }))
  const cat = (n: string) => categories.find((c) => c.name === n)!.id
  const tech = (...ns: string[]) => ns.map((n) => techs.find((t) => t.name === n)!.id)

  const official = profile({
    id: OFFICIAL_USER_ID,
    handle: 'zenospace',
    displayName: 'zenospace 公式',
    isOfficial: true,
    bio: 'zenospace の公式アカウントです。毎朝のAIニュースとお知らせを届けます。',
    avatarColor: '#1F4D3B',
    createdAt: ago(120 * D),
    commissionStatus: 'closed',
  })
  const kura = profile({
    id: sid('usr00000'),
    handle: 'kura',
    displayName: 'くら',
    bio: 'zenospace 運営。Webディレクターです。LPとブランドサイトが好き。',
    skills: ['ディレクション', 'LP制作', 'Figma'],
    prefecture: '福岡県',
    interests: ['LP制作', '生成AI', 'UI/UX'],
    coverUrl: coverArt('#1f4d3b', '#8fb8a0'),
    links: ['https://example.com/kura'],
    createdAt: ago(100 * D),
  })
  const creators: Profile[] = [
    {
      handle: 'mio_design',
      displayName: 'みお',
      bio: '飲食・美容のLPを中心に制作しています。STUDIO と Figma が得意です。',
      skills: ['LP制作', 'STUDIO', 'Figma'],
      prefecture: '東京都',
      commissionStatus: 'open' as const,
    },
    {
      handle: 'taku_dev',
      displayName: 'たく',
      bio: 'React / Next.js のフロントエンドエンジニア。SaaS の管理画面が得意。',
      skills: ['React', 'Next.js', 'TypeScript'],
      prefecture: '大阪府',
      commissionStatus: 'consult' as const,
    },
    {
      handle: 'hana_illust',
      displayName: 'はな',
      bio: 'イラストレーター。やわらかいタッチのキャラクターと挿絵を描きます。',
      skills: ['イラスト', 'Procreate'],
      prefecture: '京都府',
      commissionStatus: 'open' as const,
    },
    {
      handle: 'ren_movie',
      displayName: 'れん',
      bio: '店舗紹介や採用向けのショート動画を撮影・編集しています。',
      skills: ['動画編集', 'Premiere Pro'],
      prefecture: '福岡県',
      commissionStatus: 'closed' as const,
    },
    {
      handle: 'sora_app',
      displayName: 'そら',
      bio: 'Flutter で個人アプリを開発。習慣化アプリを公開中です。',
      skills: ['Flutter', 'アプリ開発'],
      prefecture: '北海道',
      commissionStatus: 'consult' as const,
    },
    {
      handle: 'yui_wp',
      displayName: 'ゆい',
      bio: 'WordPress で士業・医療系のサイトを制作。更新しやすさ重視。',
      skills: ['WordPress', 'SEO'],
      prefecture: '愛知県',
      commissionStatus: 'open' as const,
    },
    {
      handle: 'kai_photo',
      displayName: 'かい',
      bio: '料理と空間の写真を撮っています。',
      skills: ['写真', 'Lightroom'],
      prefecture: '神奈川県',
      commissionStatus: 'open' as const,
      createdAt: ago(5 * D),
    },
  ].map((c, i) =>
    profile({
      id: sid('usr00000'),
      coverUrl: coverArt(
        ['#1f4d3b', '#2f4a44', '#4a3f35', '#24443a', '#3f3a2f', '#2b3a33', '#35473f'][i],
        ['#9cc9ae', '#b9c7bf', '#d4c3ad', '#a9c7b2', '#d8cfb8', '#c2cfc7', '#b7cbbd'][i],
      ),
      interests: ['Webデザイン', 'LP制作'],
      createdAt: ago((50 - i * 5) * D),
      ...c,
    }),
  )
  const [mio, taku, hana, ren, sora, yui, kai] = creators
  const users = [official, kura, ...creators]

  // 1人1アカウント判定用の識別子（ZS-ONE-01/02）
  const identityKeys = [
    { userId: kura.id, kind: 'google' as const, value: normalizeEmail('kura@example.com') },
    { userId: kura.id, kind: 'email' as const, value: normalizeEmail('kura@example.com') },
    ...creators.flatMap((c) => [
      { userId: c.id, kind: 'google' as const, value: normalizeEmail(`${c.handle.replace('_', '.')}@gmail.com`) },
      { userId: c.id, kind: 'email' as const, value: normalizeEmail(`${c.handle.replace('_', '.')}@gmail.com`) },
    ]),
  ]

  // ---- 作品 ----
  type W = [
    owner: Profile,
    type: WorkType,
    title: string,
    catchCopy: string,
    category: string,
    techs: string[],
    tags: string[],
    c1: string,
    c2: string,
    prod: 'client' | 'personal' | 'study',
    price: [number, number] | null,
    ageDays: number,
    likes: number,
    views: number,
  ]
  const workDefs: W[] = [
    [
      mio,
      'lp',
      '自家焙煎カフェ「灯」LP',
      '朝の一杯から始まる、ていねいな暮らし。',
      '飲食',
      ['STUDIO', 'Figma'],
      ['カフェ', 'ナチュラル'],
      '#7c4a2d',
      '#e0b084',
      'client',
      [50000, 100000],
      1,
      42,
      380,
    ],
    [
      mio,
      'lp',
      'ヘアサロン予約LP',
      '予約率が1.6倍になった導線設計。',
      '美容',
      ['STUDIO', 'Figma'],
      ['サロン', '予約'],
      '#d97795',
      '#f5c6d6',
      'client',
      [80000, 150000],
      12,
      128,
      1520,
    ],
    [
      taku,
      'app',
      'チームの勤怠SaaS',
      '打刻から月末の集計まで、ひとつの画面で。',
      'SaaS',
      ['React', 'TypeScript', 'Tailwind CSS'],
      ['管理画面', 'B2B'],
      '#1e3a8a',
      '#22d3ee',
      'client',
      [300000, 800000],
      20,
      96,
      2100,
    ],
    [
      taku,
      'hp',
      'Next.js で作った技術ブログ',
      '表示速度 Lighthouse 100 を目指した個人ブログ。',
      'その他',
      ['Next.js', 'TypeScript'],
      ['ブログ', 'Jamstack'],
      '#111827',
      '#6a4df5',
      'personal',
      null,
      3,
      33,
      410,
    ],
    [
      hana,
      'image',
      '季節のキャラクター集',
      '春夏秋冬をテーマにしたやわらかいキャラクター。',
      'エンタメ',
      ['Photoshop'],
      ['キャラクター', '水彩'],
      '#f9a8d4',
      '#a5b4fc',
      'personal',
      [20000, 60000],
      2,
      210,
      1880,
    ],
    [
      hana,
      'image',
      '絵本の挿絵「ほしのこ」',
      '星の子が夜空を旅する絵本のための挿絵。',
      '教育',
      ['Illustrator'],
      ['絵本', '挿絵'],
      '#1e1b4b',
      '#fbbf24',
      'client',
      [100000, 200000],
      30,
      154,
      990,
    ],
    [
      ren,
      'video',
      '居酒屋の30秒PR動画',
      'SNS 広告向けの縦型ショート。',
      '飲食',
      ['Premiere Pro', 'After Effects'],
      ['ショート動画', '縦型'],
      '#7f1d1d',
      '#f59e0b',
      'client',
      [50000, 120000],
      6,
      77,
      870,
    ],
    [
      ren,
      'video',
      '採用ムービー（IT企業）',
      '社員インタビューで伝える働く理由。',
      'SaaS',
      ['Premiere Pro'],
      ['採用', 'インタビュー'],
      '#0f172a',
      '#38bdf8',
      'client',
      [200000, 400000],
      45,
      61,
      640,
    ],
    [
      sora,
      'app',
      '習慣化アプリ「ちりつも」',
      '1日1分、続けたことが星座になる。',
      '教育',
      ['Flutter'],
      ['習慣化', '個人開発'],
      '#312e81',
      '#34d399',
      'personal',
      null,
      9,
      188,
      2400,
    ],
    [
      sora,
      'app',
      '家計簿ウィジェット',
      'ホーム画面で今月の残りがひと目で分かる。',
      'その他',
      ['Swift'],
      ['家計簿', 'ウィジェット'],
      '#064e3b',
      '#a7f3d0',
      'study',
      null,
      60,
      24,
      300,
    ],
    [
      yui,
      'hp',
      '行政書士事務所サイト',
      '相談のハードルを下げる、やさしいトーン。',
      '士業',
      ['WordPress'],
      ['士業', 'コーポレート'],
      '#1e3a5f',
      '#93c5fd',
      'client',
      [150000, 300000],
      15,
      45,
      720,
    ],
    [
      yui,
      'hp',
      '歯科クリニックのサイト',
      '初診の不安に答えるQ&A構成。',
      '医療',
      ['WordPress'],
      ['医療', 'クリニック'],
      '#0e7490',
      '#e0f2fe',
      'client',
      [200000, 400000],
      25,
      52,
      830,
    ],
    [
      kai,
      'image',
      '料理写真ポートフォリオ',
      '光と湯気で伝える、できたての温度。',
      '飲食',
      ['Photoshop'],
      ['料理写真', 'フード'],
      '#78350f',
      '#fde68a',
      'personal',
      [30000, 80000],
      0.5,
      12,
      90,
    ],
    [
      kura,
      'lp',
      'オンラインスクール募集LP',
      '受講生の声を中心にした構成。',
      '教育',
      ['STUDIO', 'Figma'],
      ['スクール', '募集'],
      '#4c1d95',
      '#22d3ee',
      'client',
      [100000, 200000],
      8,
      66,
      760,
    ],
    [
      mio,
      'hp',
      'ネイルサロンのブランドサイト',
      '世界観を伝えるギャラリー中心の設計。',
      '美容',
      ['Wix', 'Figma'],
      ['ネイル', 'ブランディング'],
      '#9d174d',
      '#fbcfe8',
      'client',
      [120000, 250000],
      40,
      90,
      1100,
    ],
    [
      taku,
      'lp',
      'SaaS の料金ページ改善',
      '比較表と FAQ で問い合わせを減らす。',
      'SaaS',
      ['Next.js', 'Tailwind CSS'],
      ['料金ページ', 'CRO'],
      '#0b0d17',
      '#9d85ff',
      'study',
      null,
      4,
      28,
      330,
    ],
    [
      hana,
      'other',
      'オリジナルLINEスタンプ',
      '使いやすい挨拶40種。',
      'エンタメ',
      ['Procreate'],
      ['スタンプ'],
      '#fde68a',
      '#f472b6',
      'personal',
      null,
      18,
      140,
      1300,
    ],
    [
      yui,
      'lp',
      '不動産の内覧予約LP',
      '物件写真を大きく、予約は2タップ。',
      '不動産',
      ['WordPress'],
      ['不動産', '予約'],
      '#14532d',
      '#bbf7d0',
      'client',
      [80000, 160000],
      2.5,
      19,
      210,
    ],
    [
      sora,
      'hp',
      'EC サイトのリニューアル',
      'Shopify で商品数300点を移行。',
      'EC',
      ['Shopify'],
      ['EC', 'リニューアル'],
      '#1f2937',
      '#fb923c',
      'client',
      [300000, 600000],
      35,
      70,
      950,
    ],
    [
      mio,
      'image',
      'カフェのメニューデザイン',
      '黒板風から明るい印象へ。',
      '飲食',
      ['Canva', 'Illustrator'],
      ['メニュー', '印刷物'],
      '#3f2d0f',
      '#fef3c7',
      'client',
      [20000, 50000],
      1.5,
      30,
      260,
    ],
  ]
  const works: Work[] = workDefs.map((w, i) => {
    const [owner, type, title, catchCopy, category, ts, tags, c1, c2, prod, price, ageDays, likes, views] = w
    const id = sid('wrk00000')
    const media = [0, 1, 2].map((v) => ({
      id: sid('med00000'),
      url: workThumb(title, v === 0 ? c1 : c2, v === 0 ? c2 : c1, type, v),
      thumbUrl: workThumb(title, v === 0 ? c1 : c2, v === 0 ? c2 : c1, type, v, 400, 250),
      width: 1200,
      height: 750,
      altText: '',
      dominantColor: c1,
    }))
    return {
      id,
      ownerId: owner.id,
      type,
      title,
      catchCopy,
      description: `# 概要\n${catchCopy}\n\n# 工夫した点\n- 最初の3秒で何のページか伝わる構成\n- スマホでの読みやすさを優先\n- 問い合わせまでの導線を短く\n\n詳しくは https://example.com/works/${i + 1} をご覧ください。`,
      categoryId: cat(category),
      techIds: tech(...ts.filter((t) => DEFAULT_TECHS.includes(t))),
      tags,
      productionType: prod,
      roles: type === 'video' ? ['撮影', '編集'] : type === 'image' ? ['デザイン'] : ['デザイン', 'コーディング'],
      periodValue: (i % 4) + 1,
      periodUnit: i % 3 === 0 ? 'month' : 'week',
      priceMin: price?.[0] ?? null,
      priceMax: price?.[1] ?? null,
      url: type === 'hp' || type === 'lp' ? `https://example.com/works/${i + 1}` : '',
      storeUrl: type === 'app' ? 'https://apps.apple.com/jp/app/id000000' : '',
      videoUrl: type === 'video' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : '',
      visibility: 'public',
      licenseConfirmed: prod === 'client',
      status: 'active',
      hiddenReason: null,
      media,
      likeCount: likes,
      viewCount: views,
      inquiryCount: Math.floor(likes / 20),
      publishedAt: ago(ageDays * D),
      createdAt: ago(ageDays * D + H),
      updatedAt: ago(ageDays * D),
      deletedAt: null,
    }
  })

  const workDailyStats = works.flatMap((w) =>
    Array.from({ length: 14 }, (_, d) => ({
      workId: w.id,
      date: jstDateKey(ago((13 - d) * D)),
      views: Math.round((w.viewCount / 30) * (0.5 + ((d * 7 + w.title.length) % 10) / 10)),
      likes: Math.round((w.likeCount / 30) * (0.4 + ((d * 3 + w.title.length) % 10) / 10)),
      inquiries: (d + w.title.length) % 5 === 0 ? 1 : 0,
    })),
  )

  // ---- トーク ----
  const rooms: Room[] = []
  const roomMembers: RoomMember[] = []
  const messages: Message[] = []
  let msgSeq = 0
  const addRoom = (r: Partial<Room> & Pick<Room, 'kind'>, members: { id: string; role?: RoomMember['role']; state?: RoomMember['state'] }[]) => {
    const room: Room = {
      id: sid('rom00000'),
      name: null,
      iconUrl: null,
      iconColor: '#6A4DF5',
      ownerId: null,
      workId: null,
      lastMessageAt: ago(30 * D),
      lastMessagePreview: '',
      memberCount: members.length,
      createdAt: ago(30 * D),
      ...r,
    }
    rooms.push(room)
    for (const m of members)
      roomMembers.push({
        roomId: room.id,
        userId: m.id,
        role: m.role ?? 'member',
        state: m.state ?? 'active',
        lastReadAt: ago(D),
        notifyLevel: 'all',
        pinnedAt: null,
        hiddenAt: null,
        joinedAt: room.createdAt,
      })
    return room
  }
  const say = (room: Room, sender: Profile, body: string, at: number, extra: Partial<Message> = {}) => {
    msgSeq += 1
    const m: Message = {
      id: msgSeq,
      roomId: room.id,
      senderId: sender.id,
      kind: 'text',
      body,
      replyToId: null,
      meta: {},
      clientId: `seed-${msgSeq}`,
      createdAt: ago(at),
      unsentAt: null,
      ...extra,
    }
    messages.push(m)
    room.lastMessageAt = m.createdAt
    room.lastMessagePreview = m.kind === 'work' ? '作品を共有しました' : body
    return m
  }

  // 公式トーク（全ユーザー分。本文は broadcasts から読み出す）
  for (const u of users.filter((u) => !u.isOfficial)) {
    const r = addRoom(
      { kind: 'official', name: 'zenospace 公式', createdAt: u.createdAt, lastMessageAt: u.createdAt, lastMessagePreview: 'zenospace へようこそ！' },
      [{ id: u.id }, { id: official.id, role: 'owner' }],
    )
    r.memberCount = 2
  }

  const dm1 = addRoom({ kind: 'direct' }, [{ id: kura.id }, { id: mio.id }])
  say(dm1, mio, 'くらさん、先日はスクールのLPの件ありがとうございました！', 26 * H)
  say(dm1, kura, 'こちらこそ！公開後の反応もすごく良いです', 25 * H)
  say(dm1, mio, '良かったです😊 次の募集の時もぜひ', 25 * H - 60_000)
  say(dm1, kura, '来月また相談させてください', 3 * H)

  const grp = addRoom({ kind: 'group', name: 'AIスクール 9期', iconColor: '#3D6B52', ownerId: kura.id }, [
    { id: kura.id, role: 'owner' },
    { id: mio.id, role: 'admin' },
    { id: taku.id },
    { id: hana.id },
    { id: sora.id },
  ])
  say(grp, kura, 'みなさん、今週の課題提出は金曜までです！', 30 * H, { kind: 'text' })
  say(grp, taku, '了解です〜', 29 * H)
  say(grp, hana, 'イラストの課題も同じ締切ですか？', 28 * H)
  say(grp, kura, 'はい、同じです🙆', 27 * H)
  say(grp, sora, '今朝のAIニュース、新しいモデルの話題おもしろかったですね', 2 * H)
  say(grp, taku, '要約がちょうどいい長さで助かる', 90 * 60_000)

  const inq = addRoom({ kind: 'inquiry', workId: works[13].id }, [{ id: kura.id }, { id: yui.id }])
  say(inq, yui, '', 6 * H, { kind: 'work', meta: { workId: works[13].id } })
  say(inq, yui, 'はじめまして。こちらの作品を拝見し、制作のご相談をしたくご連絡しました。士業向けのスクール募集LPを検討しています。', 6 * H - 60_000)

  // メッセージリクエスト（友だちでない相手から）
  const req = addRoom({ kind: 'direct' }, [{ id: kura.id, state: 'request' }, { id: kai.id }])
  say(req, kai, 'はじめまして、料理写真を撮っている かい です。カフェLPの撮影でご一緒できたら嬉しいです。', 5 * H)

  for (const m of roomMembers) {
    const room = rooms.find((r) => r.id === m.roomId)!
    // kura は一部未読
    m.lastReadAt = m.userId === kura.id && (room.id === grp.id || room.id === inq.id) ? ago(3 * H) : room.lastMessageAt
  }
  const roomOf = (u: Profile) => rooms.find((r) => r.kind === 'official' && roomMembers.some((m) => m.roomId === r.id && m.userId === u.id))!

  const inquiries = [
    {
      id: sid('inq00000'),
      roomId: inq.id,
      workId: works[13].id,
      fromUser: yui.id,
      toUser: kura.id,
      template: 'consult',
      createdAt: ago(6 * H),
      firstReplyAt: null,
    },
  ]

  // ---- AIニュース ----
  const newsSources = [
    ['Anthropic News', 'https://www.anthropic.com/news/rss.xml', 'en', 1.0],
    ['OpenAI Blog', 'https://openai.com/blog/rss.xml', 'en', 1.0],
    ['Google DeepMind Blog', 'https://deepmind.google/blog/rss.xml', 'en', 0.9],
    ['ITmedia AI+', 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml', 'ja', 0.8],
    ['Hugging Face Blog', 'https://huggingface.co/blog/feed.xml', 'en', 0.7],
  ].map(([name, feedUrl, lang, weight]) => ({
    id: sid('src00000'),
    name: name as string,
    feedUrl: feedUrl as string,
    lang: lang as 'ja' | 'en',
    weight: weight as number,
    enabled: true,
    lastSuccessAt: ago(20 * H),
    failureCount: name === 'Hugging Face Blog' ? 2 : 0,
    termsCheckedAt: ago(10 * D),
  }))
  const headlines: [string, NewsCategory][] = [
    ['新しい大規模言語モデルが公開、長文の推論性能が向上', 'model'],
    ['画像生成AIに商用利用向けの新プラン', 'product'],
    ['AIエージェントの安全性評価に関する研究が公開', 'research'],
    ['国内でAI事業者ガイドラインの改定案', 'policy'],
    ['生成AIスタートアップが大型の資金調達', 'business'],
    ['音声対話AIが日本語の応答速度を改善', 'product'],
    ['小型モデルを端末上で動かす手法の論文', 'research'],
    ['教育現場での生成AI活用事例まとめ', 'business'],
  ]
  const newsDigests = []
  const newsItems: NewsItem[] = []
  for (let d = 3; d >= 1; d--) {
    const digestId = sid('dig00000')
    const date = jstDateKey(ago(d * D))
    newsDigests.push({
      id: digestId,
      date,
      status: 'sent' as const,
      stage: 'sent' as const,
      failedStage: null,
      approvedBy: kura.id,
      sentAt: ago(d * D),
      broadcastId: null as string | null,
    })
    for (let i = 0; i < 5; i++) {
      const [t, c] = headlines[(i + d) % headlines.length]
      const src = newsSources[(i + d) % newsSources.length]
      newsItems.push({
        id: sid('nws00000'),
        sourceId: src.id,
        url: `https://example.com/news/${date}/${i}`,
        title: t,
        titleJa: t,
        summaryJa: `${t}。発表によると、従来より使いやすさと性能が改善され、開発者向けの提供も始まる。国内での提供時期は未定。`.slice(0, 120),
        category: c,
        publishedAt: ago(d * D + i * H),
        score: 90 - i * 7,
        scoreDetail: { weight: src.weight * 40, keyword: 30 - i * 3, freshness: 20 - i * 4 },
        digestId,
        rank: i + 1,
      })
    }
  }

  // 過去のAIニュースと歓迎メッセージを配信として保存（本文は1件だけ）
  const broadcasts = [
    {
      id: sid('brd00000'),
      title: 'ようこそ',
      status: 'sent' as const,
      audience: 'all' as const,
      segmentQuery: null,
      bubbles: [
        { type: 'text' as const, text: '{name}さん、zenospace へようこそ！\n作品を見つけて、気になった制作者とそのまま話してみましょう。' },
        {
          type: 'card' as const,
          card: {
            title: 'はじめての方へ',
            body: 'プロフィールを整えて、最初の作品を投稿してみましょう。',
            buttons: [
              { key: 'post', label: '作品を投稿する', url: '/post' },
              { key: 'guide', label: '使い方を見る', url: '/settings/help' },
            ],
          },
        },
      ],
      pushText: 'zenospace へようこそ！',
      scheduledAt: null,
      sentAt: ago(120 * D),
      canceledAt: null,
      targetCount: 9,
      pushDelivered: 7,
      createdBy: kura.id,
      approvedBy: kura.id,
      createdAt: ago(120 * D),
      kind: 'broadcast' as const,
    },
  ]
  for (const dg of newsDigests) {
    const items = newsItems.filter((n) => n.digestId === dg.id)
    const b = {
      id: sid('brd00000'),
      title: `AIニュース ${dg.date}`,
      status: 'sent' as const,
      audience: 'all' as const,
      segmentQuery: null,
      bubbles: [
        {
          type: 'carousel' as const,
          cards: items.map((n) => ({ title: n.titleJa, body: n.summaryJa ?? '', buttons: [{ key: n.id, label: '元記事を読む', url: n.url }] })),
        },
      ],
      pushText: `今日のAIニュース ${items.length}本`,
      scheduledAt: null,
      sentAt: dg.sentAt!,
      canceledAt: null,
      targetCount: 9,
      pushDelivered: 8,
      createdBy: kura.id,
      approvedBy: kura.id,
      createdAt: dg.sentAt!,
      kind: 'news' as const,
    }
    dg.broadcastId = b.id
    broadcasts.push(b as never)
  }
  for (const u of users.filter((u) => !u.isOfficial)) {
    const r = roomOf(u)
    r.lastMessageAt = broadcasts[broadcasts.length - 1].sentAt!
    r.lastMessagePreview = '今日のAIニュース 5本'
  }

  const broadcastEvents = broadcasts.flatMap((b) =>
    users
      .filter((u) => !u.isOfficial)
      .slice(0, 6)
      .flatMap((u, i) => [
        { broadcastId: b.id, userId: u.id, kind: 'read' as const, buttonKey: null, createdAt: b.sentAt! },
        ...(i % 2 === 0 ? [{ broadcastId: b.id, userId: u.id, kind: 'click' as const, buttonKey: 'post', createdAt: b.sentAt! }] : []),
      ]),
  )

  // ---- 運営 ----
  const usageSnapshots = Array.from({ length: 14 }, (_, d) => {
    const date = jstDateKey(ago((13 - d) * D))
    const g = 1 + d * 0.03
    return [
      { date, metric: 'db_bytes' as const, value: Math.round(118e6 * g) },
      { date, metric: 'storage_bytes' as const, value: Math.round(20e6 * g) },
      { date, metric: 'realtime_peak' as const, value: Math.round(18 + d) },
      { date, metric: 'realtime_messages' as const, value: Math.round(380_000 * g) },
      { date, metric: 'egress_bytes' as const, value: Math.round(1.2e9 * g) },
      { date, metric: 'function_invocations' as const, value: Math.round(61_000 * g) },
      { date, metric: 'worker_requests' as const, value: Math.round(21_000 * g) },
      { date, metric: 'r2_bytes' as const, value: Math.round(2.4e9 * g) },
    ]
  }).flat()

  const notifications = [
    {
      id: sid('ntf00000'),
      userId: kura.id,
      kind: 'like' as const,
      actorId: mio.id,
      target: `/works/${works[13].id}`,
      text: 'みおさんたち3人があなたの作品にいいねしました',
      groupedCount: 3,
      readAt: null,
      createdAt: ago(2 * H),
    },
    {
      id: sid('ntf00000'),
      userId: kura.id,
      kind: 'inquiry' as const,
      actorId: yui.id,
      target: `/talk/${inq.id}`,
      text: 'ゆいさんから「オンラインスクール募集LP」への問い合わせが届きました',
      groupedCount: 1,
      readAt: null,
      createdAt: ago(6 * H),
    },
    {
      id: sid('ntf00000'),
      userId: kura.id,
      kind: 'request' as const,
      actorId: kai.id,
      target: '/talk/requests',
      text: '新しいメッセージリクエストが1件あります',
      groupedCount: 1,
      readAt: null,
      createdAt: ago(5 * H),
    },
    {
      id: sid('ntf00000'),
      userId: kura.id,
      kind: 'friend' as const,
      actorId: sora.id,
      target: `/u/${sora.handle}`,
      text: 'そらさんがあなたを友だちに追加しました',
      groupedCount: 1,
      readAt: ago(D),
      createdAt: ago(2 * D),
    },
    {
      id: sid('ntf00000'),
      userId: kura.id,
      kind: 'news' as const,
      actorId: official.id,
      target: '/news',
      text: '今日のAIニュース 5本',
      groupedCount: 1,
      readAt: ago(D),
      createdAt: ago(D),
    },
  ]

  const reports = [
    {
      id: sid('rep00000'),
      reporterId: mio.id,
      targetType: 'user' as const,
      targetId: kai.id,
      reason: 'スパム・宣伝',
      detail: '同じ営業メッセージが複数人に届いているようです。',
      sharedMessages: null,
      status: 'open' as const,
      assigneeId: null,
      createdAt: ago(30 * H),
      firstActionAt: null,
      resolvedAt: null,
    },
    {
      id: sid('rep00000'),
      reporterId: taku.id,
      targetType: 'work' as const,
      targetId: works[16].id,
      reason: '他人の作品の無断掲載',
      detail: '似たスタンプを別の作者で見かけました。',
      sharedMessages: null,
      status: 'open' as const,
      assigneeId: null,
      createdAt: ago(4 * H),
      firstActionAt: null,
      resolvedAt: null,
    },
  ]

  return {
    version: SEED_VERSION,
    profiles: users,
    identityKeys,
    bannedIdentities: [],
    deviceHashes: [
      { userId: ren.id, deviceHash: 'dev-hash-shared-01', firstSeenAt: ago(40 * D), lastSeenAt: ago(D) },
      { userId: kai.id, deviceHash: 'dev-hash-shared-01', firstSeenAt: ago(5 * D), lastSeenAt: ago(H) },
    ],
    consents: users.flatMap((u) => [
      { userId: u.id, doc: 'terms' as const, version: TERMS_VERSION, agreedAt: u.createdAt },
      { userId: u.id, doc: 'privacy' as const, version: TERMS_VERSION, agreedAt: u.createdAt },
    ]),
    userSettings: users.map((u) => defaultSettings(u.id)),
    friendships: [
      { userId: kura.id, friendId: mio.id, hidden: false, createdAt: ago(40 * D) },
      { userId: mio.id, friendId: kura.id, hidden: false, createdAt: ago(40 * D) },
      { userId: kura.id, friendId: taku.id, hidden: false, createdAt: ago(30 * D) },
      { userId: sora.id, friendId: kura.id, hidden: false, createdAt: ago(2 * D) },
      { userId: taku.id, friendId: kura.id, hidden: false, createdAt: ago(30 * D) },
    ],
    blocks: [],
    inviteCodes: [],
    rooms,
    roomMembers,
    messages,
    messageHides: [],
    reactions: [{ messageId: 4, userId: mio.id, kind: 'heart', createdAt: ago(3 * H) }],
    roomInvites: [],
    announcements: [{ roomId: grp.id, messageId: messages.find((m) => m.roomId === grp.id)!.id, pinnedBy: kura.id }],
    inquiries,
    works,
    categories,
    techs,
    likes: [
      { userId: kura.id, workId: works[0].id, createdAt: ago(5 * H) },
      { userId: kura.id, workId: works[4].id, createdAt: ago(2 * D) },
      { userId: kura.id, workId: works[8].id, createdAt: ago(3 * D) },
    ],
    collections: [{ id: sid('col00000'), userId: kura.id, name: 'LPの参考', workIds: [works[0].id], createdAt: ago(3 * D) }],
    viewHistory: [
      { userId: kura.id, workId: works[2].id, viewedAt: ago(H) },
      { userId: kura.id, workId: works[0].id, viewedAt: ago(5 * H) },
    ],
    workDailyStats,
    savedSearches: [],
    searchHistory: [],
    pickups: [works[1].id, works[8].id, works[4].id, works[2].id],
    notifications,
    pushSubscriptions: [],
    broadcasts,
    broadcastRecipients: [],
    broadcastEvents,
    banners: [
      {
        id: sid('ban00000'),
        title: 'メンテナンスのお知らせ',
        body: '10月5日 2:00〜4:00 にメンテナンスを行います。',
        link: null,
        startsAt: ago(D),
        endsAt: new Date(Date.now() + 4 * D).toISOString(),
        target: 'home' as const,
      },
    ],
    dismissedBanners: [],
    newsSources,
    newsItems,
    newsDigests,
    newsReactions: [],
    adminMembers: [{ userId: kura.id, role: 'owner', totpEnrolled: true }],
    restrictions: [],
    appeals: [],
    reports,
    dupSuspicions: [
      {
        id: sid('dup00000'),
        deviceHash: 'dev-hash-shared-01',
        userIds: [ren.id, kai.id],
        status: 'open',
        decision: null,
        decidedBy: null,
        createdAt: ago(5 * D),
      },
    ],
    supportThreads: [],
    supportTemplates: [
      { id: sid('tpl00000'), title: 'お問い合わせのお礼', body: 'お問い合わせありがとうございます。確認して改めてご連絡します。' },
      {
        id: sid('tpl00000'),
        title: 'ログインできない',
        body: 'Googleアカウントでのログインをお試しください。解決しない場合は、お使いの端末とブラウザを教えてください。',
      },
    ],
    ngWords: [
      { id: sid('ngw00000'), word: '必ず儲かる', severity: 'block' },
      { id: sid('ngw00000'), word: 'LINE交換', severity: 'warn' },
    ],
    auditLogs: [],
    settings: structuredClone(defaultAppSettings),
    usageSnapshots,
    seq: { message: msgSeq },
  }
}

export const DEMO_ACCOUNTS = [
  { email: 'kura@example.com', label: 'くら（運営オーナー）' },
  { email: 'mio.design@gmail.com', label: 'みお（LP制作）' },
  { email: 'taku.dev@gmail.com', label: 'たく（エンジニア）' },
  { email: 'hana.illust@gmail.com', label: 'はな（イラスト）' },
]
