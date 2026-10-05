import { splitLinks } from '@/lib/markup'
import { OFFICIAL_USER_ID } from '@/lib/constants'

/**
 * URL を自動でリンク化する。外部リンクは開く前に確認を出す（ZS-SAFE-04）。
 * rel="noopener noreferrer ugc" を付ける（18.3）。
 */
export function Linkified({ text, senderId, className }: { text: string; senderId?: string; className?: string }) {
  const parts = splitLinks(text)
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.url ? (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer ugc"
            className="break-all underline underline-offset-2"
            onClick={(e) => {
              if (senderId === OFFICIAL_USER_ID) return
              if (!confirm(`外部サイトへ移動します\n${p.url}`)) e.preventDefault()
            }}
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  )
}
