import { useEffect, useState } from 'react'

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mql = window.matchMedia(q)
    const on = () => setM(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [q])
  return m
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')
export const useIsTablet = () => useMediaQuery('(min-width: 640px)')

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** 300ms 以内に終わる読み込みでは何も出さない（15.1） */
export function useDelayedFlag(flag: boolean, ms = 300): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!flag) {
      setShow(false)
      return
    }
    const t = setTimeout(() => setShow(true), ms)
    return () => clearTimeout(t)
  }, [flag, ms])
  return show
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === 'true'
}

/** 12.3 触覚は Vibration API 対応端末だけ */
export function haptic(ms = 10) {
  if (prefersReducedMotion()) return
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* noop */
  }
}
