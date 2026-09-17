import { describe, expect, it } from 'vitest'
import { activeAtToken, activeSlashToken, formatFileMention } from '../src/renderer/composer-mentions'

describe('composer-mentions', () => {
  describe('activeAtToken', () => {
    it('detects a plain token at the start or after whitespace', () => {
      expect(activeAtToken('@sr', 3)).toEqual({ start: 0, end: 3, query: 'sr', quoted: false })
      expect(activeAtToken('see @src/ma', 11)).toEqual({ start: 4, end: 11, query: 'src/ma', quoted: false })
    })

    it('detects a quoted token and keeps the quote inside the prefix', () => {
      expect(activeAtToken('@"my file', 9)).toEqual({ start: 0, end: 9, query: 'my file', quoted: true })
      expect(activeAtToken('look @"a b/c', 12)).toEqual({ start: 5, end: 12, query: 'a b/c', quoted: true })
    })

    it('rejects an @ inside a word such as an email address', () => {
      expect(activeAtToken('user@example.com', 10)).toBeUndefined()
    })

    it('is undefined when the cursor leaves the token', () => {
      expect(activeAtToken('@src done', 9)).toBeUndefined()
    })
  })

  describe('activeSlashToken', () => {
    it('accepts a leading slash token at the cursor', () => {
      expect(activeSlashToken('/comp', 5)).toEqual({ start: 0, end: 5, query: 'comp' })
    })

    it('is case-insensitive while typing', () => {
      expect(activeSlashToken('/Compact', 8)?.query).toBe('Compact')
    })

    it('rejects a slash that is not the first character or contains whitespace', () => {
      expect(activeSlashToken('hello /comp', 11)).toBeUndefined()
      expect(activeSlashToken('/comp act', 9)).toBeUndefined()
      expect(activeSlashToken('', 0)).toBeUndefined()
    })
  })

  describe('formatFileMention', () => {
    it('formats plain paths and appends a trailing slash for directories', () => {
      expect(formatFileMention({ path: 'src/main.ts', kind: 'file' }, false)).toBe('@src/main.ts')
      expect(formatFileMention({ path: 'src', kind: 'directory' }, false)).toBe('@src/')
    })

    it('quotes paths containing whitespace', () => {
      expect(formatFileMention({ path: 'my docs/read me.md', kind: 'file' }, false)).toBe('@"my docs/read me.md"')
      expect(formatFileMention({ path: 'my docs', kind: 'directory' }, false)).toBe('@"my docs/')
    })

    it('keeps an explicitly opened quote open for directories', () => {
      expect(formatFileMention({ path: 'src', kind: 'directory' }, true)).toBe('@"src/')
      expect(formatFileMention({ path: 'src', kind: 'file' }, true)).toBe('@"src"')
    })

    it('rejects paths the grammar cannot represent', () => {
      expect(formatFileMention({ path: 'a"b.ts', kind: 'file' }, false)).toBeUndefined()
      expect(formatFileMention({ path: 'a\nb.ts', kind: 'file' }, false)).toBeUndefined()
    })
  })
})
