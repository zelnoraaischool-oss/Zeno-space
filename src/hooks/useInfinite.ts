import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribe } from '@/lib/api'

/** 無限スクロール。条件（key）が変わったら先頭から取り直す */
export function useInfinite<T>(fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total: number }>, key: string, limit = 24) {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage
  const loadingRef = useRef(false)
  const countRef = useRef(0)
  const seq = useRef(0)

  const load = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current && !reset) return
      const n = ++seq.current
      loadingRef.current = true
      setLoading(true)
      try {
        const offset = reset ? 0 : countRef.current
        const res = await fetchRef.current(offset, reset ? Math.max(limit, countRef.current || limit) : limit)
        if (n !== seq.current) return
        setItems((prev) => {
          const next = reset ? res.items : [...prev, ...res.items]
          countRef.current = next.length
          return next
        })
        setTotal(res.total)
        setError(null)
      } catch (e) {
        if (n === seq.current) setError(e)
      } finally {
        if (n === seq.current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    },
    [limit],
  )

  useEffect(() => {
    countRef.current = 0
    setItems([])
    setTotal(null)
    void load(true)
  }, [key, load])

  // データが変わったら（いいね数など）今読み込んでいる範囲を取り直す
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const unsub = subscribe(() => {
      if (t) clearTimeout(t)
      t = setTimeout(() => void load(true), 200)
    })
    return () => {
      unsub()
      if (t) clearTimeout(t)
    }
  }, [load])

  const hasMore = total === null || items.length < total
  const sentinel = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return
      const io = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !loadingRef.current) void load(false)
        },
        { rootMargin: '600px' },
      )
      io.observe(el)
      return () => io.disconnect()
    },
    [hasMore, load],
  )

  return { items, total, loading, error, hasMore, sentinel, reload: () => load(true) }
}
