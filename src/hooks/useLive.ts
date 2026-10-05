import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribe } from '@/lib/api'

/**
 * 非同期の取得を、データの変更（Realtime 相当）のたびに取り直す。
 * 2回目以降は前の値を表示したまま裏で更新する（ちらつかせない）。
 */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean; error: unknown; reload: () => void } {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)

  const run = useCallback(() => {
    const n = ++seq.current
    fnRef
      .current()
      .then((v) => {
        if (n === seq.current) {
          setData(v)
          setError(null)
        }
      })
      .catch((e) => {
        if (n === seq.current) setError(e)
      })
      .finally(() => {
        if (n === seq.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    setLoading(true)
    run()
    let t: ReturnType<typeof setTimeout> | null = null
    const unsub = subscribe(() => {
      if (t) clearTimeout(t)
      t = setTimeout(run, 30)
    })
    return () => {
      unsub()
      if (t) clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, reload: run }
}

let version = 0
const versionListeners = new Set<() => void>()
subscribe(() => {
  version++
  for (const l of versionListeners) l()
})

function subscribeVersion(cb: () => void) {
  versionListeners.add(cb)
  return () => versionListeners.delete(cb)
}

/** 同期の読み取り（未読数など）をデータの変更に追従させる */
export function useSync<T>(fn: () => T): T {
  useSyncExternalStore(subscribeVersion, () => version)
  return fn()
}
