import type { CommissionStatus, NotificationKind, ProductionType, ReactionKind, WorkType } from './types'

export const WORK_TYPES: { value: WorkType; label: string; short: string; desc: string }[] = [
  { value: 'hp', label: 'Webサイト（HP）', short: 'HP', desc: '企業・店舗などのWebサイト' },
  { value: 'lp', label: 'LP', short: 'LP', desc: '1ページのランディングページ' },
  { value: 'app', label: 'アプリ', short: 'アプリ', desc: 'スマホアプリ・Webアプリ' },
  { value: 'image', label: '画像', short: '画像', desc: 'デザイン・イラスト・写真' },
  { value: 'video', label: '動画', short: '動画', desc: 'YouTube・Vimeo の動画' },
  { value: 'other', label: 'その他', short: 'その他', desc: 'その他の成果物' },
]
export const WORK_TYPE_LABEL = Object.fromEntries(WORK_TYPES.map((t) => [t.value, t.short])) as Record<WorkType, string>

export const PRODUCTION_TYPES: { value: ProductionType; label: string }[] = [
  { value: 'client', label: '実案件' },
  { value: 'personal', label: '自主制作' },
  { value: 'study', label: '学習課題' },
]
export const PRODUCTION_LABEL = Object.fromEntries(PRODUCTION_TYPES.map((t) => [t.value, t.label])) as Record<ProductionType, string>

export const ROLES = ['企画', 'デザイン', 'コーディング', '撮影', '編集', 'ディレクション']

export const PERIOD_UNITS = [
  { value: 'day', label: '日' },
  { value: 'week', label: '週' },
  { value: 'month', label: 'か月' },
] as const

export const COMMISSION: Record<CommissionStatus, { label: string; tone: 'success' | 'aurora' | 'muted' }> = {
  open: { label: '受付中', tone: 'success' },
  consult: { label: '相談可', tone: 'aurora' },
  closed: { label: '停止中', tone: 'muted' },
}

export const DEFAULT_CATEGORIES = ['飲食', '美容', '医療', '不動産', 'EC', '教育', 'SaaS', '士業', 'エンタメ', 'その他']
export const DEFAULT_TECHS = [
  'React',
  'Next.js',
  'Vue',
  'WordPress',
  'STUDIO',
  'Wix',
  'Shopify',
  'Figma',
  'Canva',
  'Photoshop',
  'Illustrator',
  'Flutter',
  'Swift',
  'Kotlin',
  'Premiere Pro',
  'After Effects',
  'Tailwind CSS',
  'TypeScript',
]

export const INTEREST_TAGS = [
  'Webデザイン',
  'LP制作',
  'UI/UX',
  'イラスト',
  '写真',
  '動画編集',
  'ノーコード',
  'フロントエンド',
  'アプリ開発',
  '生成AI',
  'マーケティング',
  'ブランディング',
]

export const PREFECTURES = [
  '北海道',
  '青森県',
  '岩手県',
  '宮城県',
  '秋田県',
  '山形県',
  '福島県',
  '茨城県',
  '栃木県',
  '群馬県',
  '埼玉県',
  '千葉県',
  '東京都',
  '神奈川県',
  '新潟県',
  '富山県',
  '石川県',
  '福井県',
  '山梨県',
  '長野県',
  '岐阜県',
  '静岡県',
  '愛知県',
  '三重県',
  '滋賀県',
  '京都府',
  '大阪府',
  '兵庫県',
  '奈良県',
  '和歌山県',
  '鳥取県',
  '島根県',
  '岡山県',
  '広島県',
  '山口県',
  '徳島県',
  '香川県',
  '愛媛県',
  '高知県',
  '福岡県',
  '佐賀県',
  '長崎県',
  '熊本県',
  '大分県',
  '宮崎県',
  '鹿児島県',
  '沖縄県',
]

export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: 'like', emoji: '👍', label: 'いいね' },
  { kind: 'heart', emoji: '❤️', label: 'ハート' },
  { kind: 'laugh', emoji: '😂', label: '笑い' },
  { kind: 'wow', emoji: '😮', label: '驚き' },
  { kind: 'sad', emoji: '😢', label: '悲しみ' },
  { kind: 'thanks', emoji: '🙏', label: '感謝' },
]

export const INQUIRY_TEMPLATES = [
  { key: 'consult', label: '制作の相談', text: 'はじめまして。こちらの作品を拝見し、制作のご相談をしたくご連絡しました。' },
  { key: 'question', label: '質問', text: 'はじめまして。こちらの作品について質問があります。' },
  { key: 'feedback', label: '感想', text: 'はじめまして。こちらの作品、とても素敵でした！' },
]

export const REPORT_REASONS = ['スパム・宣伝', '誹謗中傷・嫌がらせ', 'なりすまし', '他人の作品の無断掲載', '不適切な内容', '勧誘・出会い目的', 'その他']

export const RESTRICTION_REASONS = ['スパム', '迷惑メッセージ', '暴言・誹謗中傷', '不適切な作品', 'なりすまし', '複数アカウント', 'その他']

export const NOTIFICATION_TYPES: { kind: NotificationKind; label: string; push: boolean; locked?: boolean }[] = [
  { kind: 'message', label: '新着メッセージ', push: true },
  { kind: 'mention', label: 'メンション', push: true },
  { kind: 'request', label: 'メッセージリクエスト', push: true },
  { kind: 'friend', label: '友だちに追加された', push: false },
  { kind: 'like', label: '作品へのいいね', push: true },
  { kind: 'inquiry', label: '作品への問い合わせ', push: true },
  { kind: 'saved_search', label: '保存した検索条件の新着', push: true },
  { kind: 'broadcast', label: '公式アカウントの一斉配信', push: true },
  { kind: 'news', label: 'AIニュース', push: true },
  { kind: 'important', label: '利用制限などの重要なお知らせ', push: true, locked: true },
]

export const LIMITS = {
  messageLength: 2000,
  imagesPerSend: 10,
  workTitle: 40,
  catchCopy: 60,
  description: 2000,
  galleryImages: 10,
  techs: 10,
  tags: 10,
  displayName: 20,
  bio: 160,
  skills: 10,
  links: 5,
  pins: 5,
  unsendHours: 24,
  viewHistory: 100,
  announcements: 3,
  broadcastBubbles: 5,
  newBadgeHours: 72,
}

export const OFFICIAL_USER_ID = '00000000-0000-4000-8000-000000000001'
export const TERMS_VERSION = '2026-09-30'
