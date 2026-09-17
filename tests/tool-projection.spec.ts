import { describe, expect, it } from 'vitest'
import { projectToolCards } from '../src/main/runtime/harness-runtime.js'

describe('Harness tool event projection', () => {
  it('reads nested tool-result content and failure state', () => {
    expect(projectToolCards([
      { type: 'tool/call', seq: 1, time: 1, data: { callId: 'c1', name: 'bash', arguments: '{"command":"false"}' } },
      {
        type: 'tool/result', seq: 2, time: 2, data: {
          message: {
            source: { kind: 'tool', callId: 'c1' },
            content: [{
              type: 'tool-result', toolCallId: 'c1', isError: true,
              content: [{ type: 'text', text: 'command failed' }],
            }],
          },
          error: { code: 'COMMAND_FAILED' },
        },
      },
    ])).toMatchObject([{ id: 'c1', kind: 'terminal', state: 'error', output: 'command failed' }])
  })

  it('keeps web searches separate from page fetches and preserves their targets', () => {
    const cards = projectToolCards([
      { type: 'tool/call', seq: 1, time: 1, data: { callId: 'search', name: 'web_search', arguments: { queries: ['China Olympics records', 'Paris 2024 China'] } } },
      {
        type: 'tool/result', seq: 2, time: 2, data: {
          message: {
            source: { kind: 'tool', callId: 'search' },
            content: [{ type: 'tool-result', toolCallId: 'search', isError: false, content: [{ type: 'text', text: 'sources' }] }],
          },
          meta: { sources: [{ url: 'https://olympics.com/a' }, { url: 'https://olympics.com/b' }], truncated: false },
        },
      },
      { type: 'tool/call', seq: 3, time: 3, data: { callId: 'fetch', name: 'web_fetch', arguments: { url: 'https://olympics.com/a' } } },
      {
        type: 'tool/result', seq: 4, time: 4, data: {
          message: {
            source: { kind: 'tool', callId: 'fetch' },
            content: [{ type: 'tool-result', toolCallId: 'fetch', isError: false, content: [{ type: 'text', text: 'page' }] }],
          },
          meta: { url: 'https://olympics.com/a', statusCode: 200, truncated: false },
        },
      },
    ])

    expect(cards).toMatchObject([
      { id: 'search', kind: 'search', detail: 'China Olympics records · Paris 2024 China', total: 2 },
      { id: 'fetch', kind: 'web', url: 'https://olympics.com/a', statusCode: 200 },
    ])
  })

  it('uses persisted presentation metadata for replayable cards', () => {
    const cards = projectToolCards([
      { type: 'tool/call', seq: 1, time: 1, data: { callId: 'edit', name: 'edit', arguments: { file_path: 'src/a.ts' } } },
      {
        type: 'tool/result', seq: 2, time: 2, data: {
          message: {
            source: { kind: 'tool', callId: 'edit' },
            content: [{ type: 'tool-result', toolCallId: 'edit', isError: false, content: [{ type: 'text', text: 'done' }] }],
          },
          meta: { diffs: [{ path: 'src/a.ts', oldText: 'old', newText: 'new' }] },
        },
      },
    ])
    expect(cards).toMatchObject([{
      id: 'edit', kind: 'diff', state: 'complete', path: 'src/a.ts',
      diff: [{ kind: 'removed', text: 'old' }, { kind: 'added', text: 'new' }],
    }])
  })
})
