/** Scroll helpers for conversation viewports. */

const BOTTOM_TOLERANCE_PX = 48

type ConversationViewport = Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>

/** Whether the reader remains close enough to the latest conversation content. */
export function isConversationAtBottom(viewport: ConversationViewport): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= BOTTOM_TOLERANCE_PX
}

/** Move only the conversation viewport, without scrolling its ancestor elements. */
export function scrollConversationToBottom(viewport: ConversationViewport): void {
  viewport.scrollTop = viewport.scrollHeight
}
