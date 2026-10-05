export type ApiErrorCode =
  'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'restricted' | 'rate_limited' | 'conflict' | 'blocked' | 'maintenance' | 'paused'

export class ApiError extends Error {
  code: ApiErrorCode
  constructor(code: ApiErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiError'
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'エラーが発生しました。もう一度お試しください'
}
