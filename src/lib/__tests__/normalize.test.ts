import { describe, expect, it } from 'vitest'
import { matchesSearch, normalizeEmail, normalizeSearch, normalizeUrl, HANDLE_PATTERN } from '../normalize'

describe('normalizeEmail（ZS-ONE-02）', () => {
  it('大文字小文字を統一し、Gmail のドットと + 以降を除く', () => {
    expect(normalizeEmail('Alice.Smith+zen@Gmail.com')).toBe('alicesmith@gmail.com')
    expect(normalizeEmail('a.l.i.c.e.smith@googlemail.com')).toBe('alicesmith@gmail.com')
  })
  it('Gmail 以外はドットを残し、+ 以降だけ除く', () => {
    expect(normalizeEmail('first.last+tag@example.com')).toBe('first.last@example.com')
  })
  it('前後の空白を除く', () => {
    expect(normalizeEmail('  bob@example.com ')).toBe('bob@example.com')
  })
})

describe('normalizeSearch（ZS-SRCH-02 表記ゆれ吸収）', () => {
  it('カタカナとひらがな、全角と半角を同じに扱う', () => {
    expect(normalizeSearch('カフェ')).toBe(normalizeSearch('かふぇ'))
    expect(normalizeSearch('ｶﾌｪ')).toBe(normalizeSearch('カフェ'))
    expect(normalizeSearch('ＲＥＡＣＴ')).toBe('react')
  })
  it('すべての語を含むときだけ一致する', () => {
    expect(matchesSearch('自家焙煎カフェ「灯」LP', 'かふぇ lp')).toBe(true)
    expect(matchesSearch('自家焙煎カフェ「灯」LP', 'かふぇ 美容')).toBe(false)
  })
})

describe('normalizeUrl（AIニュースの重複除去）', () => {
  it('utm パラメータ、www、末尾スラッシュ、ハッシュを除く', () => {
    expect(normalizeUrl('https://www.example.com/a/?utm_source=rss&id=1#top')).toBe('https://example.com/a/?id=1')
    expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a')
  })
})

describe('ユーザーID（ZS-AUTH-04）', () => {
  it('英数字と _ の4〜20文字', () => {
    expect(HANDLE_PATTERN.test('mio_design')).toBe(true)
    expect(HANDLE_PATTERN.test('abc')).toBe(false)
    expect(HANDLE_PATTERN.test('あいうえお')).toBe(false)
    expect(HANDLE_PATTERN.test('a'.repeat(21))).toBe(false)
  })
})
