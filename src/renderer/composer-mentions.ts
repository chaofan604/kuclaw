/**
 * Composer trigger parsing for `@` file mentions and leading `/` slash menus.
 *
 * The `@` token grammar mirrors the browser-safe module
 * `@deepseek-ai/dsh-file-reference/grammar` from the fixed upstream so inserted
 * mentions stay valid for prompts and filesystem tools.
 */

/** One completion candidate for an `@` file mention. */
export interface MentionCandidate {
  path: string
  kind: 'file' | 'directory'
}

/** Active `@` token ending at the editor cursor. */
export interface ActiveAtToken {
  /** Start offset of the token (including `@` or `@"`) inside the full text. */
  start: number
  /** End offset of the token; the caret position when it was captured. */
  end: number
  /** Path query after `@` or `@"`. */
  query: string
  /** Whether the user opened a quoted path. */
  quoted: boolean
}

/** Active leading `/` token ending at the editor cursor. */
export interface ActiveSlashToken {
  /** Start offset of the `/`. */
  start: number
  /** End offset of the token; the caret position when it was captured. */
  end: number
  /** Text after the slash, without whitespace. */
  query: string
}

/**
 * Extract an `@path` or `@"path with spaces` token ending at the cursor. An `@`
 * inside another token, such as an email address, is not a trigger.
 * @param line - current editor line.
 * @param cursorCol - cursor column within that line.
 * @param lineStart - offset of the line inside the full text.
 * @returns the active token, or `undefined` outside an `@` token.
 */
export function activeAtToken(line: string, cursorCol: number, lineStart = 0): ActiveAtToken | undefined {
  const beforeCursor = line.slice(0, cursorCol)
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor)
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return {
      start: lineStart + cursorCol - quoted[1].length,
      end: lineStart + cursorCol,
      query: quoted[2],
      quoted: true,
    }
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor)
  if (plain?.[1] === undefined || plain[2] === undefined) return undefined
  return {
    start: lineStart + cursorCol - plain[1].length,
    end: lineStart + cursorCol,
    query: plain[2],
    quoted: false,
  }
}

/**
 * Extract a leading `/command` token ending at the cursor. The slash must open
 * the composer text so ordinary paths in the message never open the menu.
 * @param text - full composer text.
 * @param caret - caret offset inside the full text.
 * @returns the active token, or `undefined` when the slash is not the first character.
 */
export function activeSlashToken(text: string, caret: number): ActiveSlashToken | undefined {
  const beforeCursor = text.slice(0, caret)
  const match = /^(\/[a-z0-9_-]*)$/iu.exec(beforeCursor)
  if (match === null || match[1] === undefined) return undefined
  return { start: 0, end: caret, query: match[1].slice(1) }
}

/**
 * Format a selected path as prompt text. Whitespace uses the quoted
 * `@"path"` grammar; a quoted directory keeps that quote open after its
 * trailing slash so completion can descend another level.
 * @param candidate - selected file or directory.
 * @param preserveQuote - retain an explicitly opened quote even when unnecessary.
 * @returns the insertion value, or `undefined` for a path the editor grammar cannot represent safely.
 */
export function formatFileMention(
  candidate: MentionCandidate,
  preserveQuote: boolean,
): string | undefined {
  const path = candidate.kind === 'directory' ? `${candidate.path}/` : candidate.path
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  const quoted = preserveQuote || /\s/u.test(path)
  if (!quoted) return `@${path}`
  if (candidate.kind === 'directory') return `@"${path}`
  return `@"${path}"`
}

/** One composer text run: plain text or a displayable mention token. */
export interface MentionSegment {
  kind: 'text' | 'mention'
  value: string
}

const MENTION_DISPLAY_PATTERN = /(?<=^|\s)@"[^"\n]*"?|(?<=^|\s)@[^\s@]+/gu

/**
 * Split composer text into plain runs and mention tokens for backdrop
 * highlighting. Quoted mentions may stay unclosed while completion descends
 * a directory, so the trailing quote is optional.
 * @param text - full composer text.
 * @returns ordered segments covering the whole text.
 */
export function splitMentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(MENTION_DISPLAY_PATTERN)) {
    const value = match[0]
    const start = match.index
    if (value === undefined || start === undefined || start < cursor) continue
    if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start) })
    segments.push({ kind: 'mention', value })
    cursor = start + value.length
  }
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) })
  return segments
}
