import { describe, expect, it } from 'vitest'
import { isConversationAtBottom, scrollConversationToBottom } from '../src/renderer/conversation-scroll.js'

describe('conversation scrolling', () => {
  it('pins readers within the bottom tolerance', () => {
    expect(isConversationAtBottom({ clientHeight: 600, scrollHeight: 1_000, scrollTop: 352 })).toBe(true)
    expect(isConversationAtBottom({ clientHeight: 600, scrollHeight: 1_000, scrollTop: 351 })).toBe(false)
  })

  it('moves only the supplied conversation viewport', () => {
    const viewport = { clientHeight: 600, scrollHeight: 1_200, scrollTop: 400 }

    scrollConversationToBottom(viewport)

    expect(viewport.scrollTop).toBe(1_200)
  })
})
