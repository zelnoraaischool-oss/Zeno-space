/**
 * 運営コンソールの処理は運営メンバーしか使わないため、最初に使うときに読み込む（初回の JavaScript を 200KB 以下に保つ：18.1）。
 * 同期で読む関数（設定・テンプレート）だけはここで直接返す。
 */
import type { admin as AdminImpl } from './admin'
import type { AppSettings } from '../../types'
import { emit, state } from './store'
import { run, sb } from './core'

type A = typeof AdminImpl

const load = () => import('./admin').then((m) => m.admin)

function lazy<K extends keyof A>(key: K): A[K] {
  return ((...args: unknown[]) => load().then((m) => (m[key] as (...a: unknown[]) => unknown)(...args))) as A[K]
}

let templatesRequested = false

export const admin: A = {
  dashboard: lazy('dashboard'),
  usage: lazy('usage'),
  simulateUsage: lazy('simulateUsage'),
  searchUsers: lazy('searchUsers'),
  userDetail: lazy('userDetail'),
  restrict: lazy('restrict'),
  undoRestrictions: lazy('undoRestrictions'),
  liftRestriction: lazy('liftRestriction'),
  appeals: lazy('appeals'),
  decideAppeal: lazy('decideAppeal'),
  dupSuspicions: lazy('dupSuspicions'),
  decideDup: lazy('decideDup'),
  reports: lazy('reports'),
  updateReport: lazy('updateReport'),
  works: lazy('works'),
  setWorkHidden: lazy('setWorkHidden'),
  setPickup: lazy('setPickup'),
  broadcasts: lazy('broadcasts'),
  broadcast: lazy('broadcast'),
  estimateAudience: lazy('estimateAudience'),
  saveBroadcast: lazy('saveBroadcast'),
  requestApproval: lazy('requestApproval'),
  approveAndSend: lazy('approveAndSend'),
  testSend: lazy('testSend'),
  cancelBroadcast: lazy('cancelBroadcast'),
  deleteBroadcast: lazy('deleteBroadcast'),
  broadcastReport: lazy('broadcastReport'),
  banners: lazy('banners'),
  saveBanner: lazy('saveBanner'),
  deleteBanner: lazy('deleteBanner'),
  newsToday: lazy('newsToday'),
  runNews: lazy('runNews'),
  updateNewsItem: lazy('updateNewsItem'),
  reorderNews: lazy('reorderNews'),
  replaceNews: lazy('replaceNews'),
  approveNews: lazy('approveNews'),
  saveSource: lazy('saveSource'),
  deleteSource: lazy('deleteSource'),
  supportThreads: lazy('supportThreads'),
  supportMessages: lazy('supportMessages'),
  supportReply: lazy('supportReply'),
  updateSupport: lazy('updateSupport'),
  supportTemplates() {
    if (!templatesRequested && state.adminRole) {
      templatesRequested = true
      void run(sb().from('support_templates').select('id,title,body').order('created_at')).then((rows: { id: string; title: string; body: string }[]) => {
        state.supportTemplates = rows
        emit()
      })
    }
    return state.supportTemplates
  },
  saveMaster: lazy('saveMaster'),
  moveMaster: lazy('moveMaster'),
  deleteMaster: lazy('deleteMaster'),
  mergeTags: lazy('mergeTags'),
  saveNgWord: lazy('saveNgWord'),
  deleteNgWord: lazy('deleteNgWord'),
  saveTemplate: lazy('saveTemplate'),
  members: lazy('members'),
  setMemberRole: lazy('setMemberRole'),
  auditLogs: lazy('auditLogs'),
  auditCsv: lazy('auditCsv'),
  settings(): AppSettings {
    return state.appSettings
  },
  updateSettings: lazy('updateSettings'),
  exportUser: lazy('exportUser'),
}
