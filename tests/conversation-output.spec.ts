// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionRecord } from '../src/shared/contracts.js'
import { ActivityCard, buildConversationTurns, ConversationTurnView, Message, ReasoningPassage, summarizeReasoning, ToolStep } from '../src/renderer/CodexApp.js'
import { projectMessages, projectReasoning } from '../src/main/runtime/harness-runtime.js'

afterEach(() => {
  cleanup()
})

function session(): SessionRecord {
  return {
    id: 'session-1',
    scope: 'project',
    title: 'UI work',
    cwd: '/workspace/demo',
    createdAt: 1,
    updatedAt: 50,
    status: 'idle',
    messages: [
      { id: 'user-1', role: 'user', text: 'First', createdAt: 10, state: 'complete' },
      { id: 'assistant-1', role: 'assistant', text: 'Done', createdAt: 20, state: 'complete' },
      { id: 'user-2', role: 'user', text: 'Second', createdAt: 30, state: 'complete' },
      { id: 'assistant-2', role: 'assistant', text: 'Done again', createdAt: 40, state: 'complete' },
    ],
    reasoning: [
      { id: 'think-1', text: 'I should inspect the first file before deciding what to change.', createdAt: 12, state: 'complete' },
      { id: 'think-2', text: 'The file confirms the implementation approach.', createdAt: 17, state: 'complete' },
      { id: 'think-3', text: 'Next I should update the second file.', createdAt: 32, state: 'complete' },
    ],
    tools: [
      { id: 'read-1', title: 'Read', kind: 'read', state: 'complete', detail: '', path: 'src/first.ts', createdAt: 15 },
      { id: 'hidden-1', title: 'todo_write', kind: 'other', state: 'complete', detail: '', createdAt: 16 },
      { id: 'edit-1', title: 'Edit', kind: 'diff', state: 'complete', detail: '', path: 'src/second.ts', createdAt: 35 },
    ],
    jobs: [],
  }
}

describe('conversation output', () => {
  it('keeps reasoning and tools assigned to the turn where they occurred', () => {
    const turns = buildConversationTurns(session())

    expect(turns).toHaveLength(2)
    expect(turns[0]?.tools.map(tool => tool.id)).toEqual(['read-1'])
    expect(turns[0]?.reasoning.map(passage => passage.id)).toEqual(['think-1', 'think-2'])
    expect(turns[0]?.assistants.map(message => message.id)).toEqual(['assistant-1'])
    expect(turns[1]?.assistants.map(message => message.id)).toEqual(['assistant-2'])
  })

  it('shows completed activity in sequence and keeps the final answer after it', () => {
    const turn = buildConversationTurns(session())[0]!
    render(createElement(ConversationTurnView, { turn, active: false }))

    expect(screen.getByText('用时 0 秒')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByText('读取 1 个文件')).toBeTruthy()
    expect(screen.queryByText('正在思考')).toBeNull()
    expect(screen.queryByText('I should inspect the first file before deciding what to change.')).toBeNull()
    expect(screen.queryByText('The file confirms the implementation approach.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '读取 1 个文件' }))
    expect(screen.getByRole('button', { name: '已读取 src/first.ts' })).toBeTruthy()
    expect(screen.getByText('已读取')).toBeTruthy()
    expect(screen.getByText('src/first.ts')).toBeTruthy()
  })

  it('keeps commentary inside activity and renders the final answer separately', () => {
    const turn = buildConversationTurns(session())[0]!
    turn.assistants[0] = { ...turn.assistants[0]!, presentation: 'activity' }
    turn.assistants.push({
      id: 'assistant-final', role: 'assistant', text: 'Final result', createdAt: 25, state: 'complete', presentation: 'answer',
    })
    render(createElement(ConversationTurnView, { turn, active: false }))

    expect(screen.getByText('Final result')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('projects each settled model step into a separate reasoning passage', () => {
    const reasoning = projectReasoning([
      {
        type: 'assistant/attempt',
        seq: 1,
        time: 13,
        data: {
          turn: 1,
          step: 1,
          stream: [
            { type: 'chunk', time: 11, chunk: { type: 'reasoning-delta', index: 0, text: 'Inspect ' } },
            { type: 'chunk', time: 12, chunk: { type: 'reasoning-delta', index: 0, text: 'the file.' } },
          ],
        },
      },
      { type: 'tool/call', seq: 2, time: 14, data: {} },
      {
        type: 'assistant/message',
        seq: 3,
        time: 17,
        data: {
          turn: 1,
          step: 2,
          stream: [{ type: 'reasoning-chunks', time0: 15, index: 0, dt: [], texts: ['Continue ', 'after reading.'] }],
          message: { content: [{ type: 'reasoning', text: 'Continue after reading.' }, { type: 'text', text: 'Done' }] },
        },
      },
    ])

    expect(reasoning.map(passage => passage.text)).toEqual(['Inspect the file.', 'Continue after reading.'])
    expect(reasoning.map(passage => passage.createdAt)).toEqual([11, 15])
  })

  it('renders streaming reasoning only as a Thinking placeholder', () => {
    const view = render(createElement(ReasoningPassage, {
      passage: { id: 'live', text: '先检查入口。\n再确认调用关系。', createdAt: 1, state: 'streaming' },
    }))

    expect(screen.getByText('正在思考')).toBeTruthy()
    expect(screen.queryByText(/先检查入口/u)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(view.container.querySelector('svg')).toBeNull()
    expect(view.container.querySelector('.activity-spinner')).toBeNull()
  })

  it('never prints raw English model reasoning', () => {
    const reasoning = 'The user asks whether this agent is a harness project. I should inspect the README and explain the distinction between a model and an agent harness.'

    expect(summarizeReasoning(reasoning)).toBe('正在思考')
    render(createElement(ReasoningPassage, {
      passage: { id: 'english', text: reasoning, createdAt: 1, state: 'streaming' },
    }))

    expect(screen.getByText('正在思考')).toBeTruthy()
    expect(screen.queryByText(reasoning)).toBeNull()
  })

  it('renders assistant Markdown as structured response content', () => {
    render(createElement(Message, {
      message: {
        id: 'assistant',
        role: 'assistant',
        text: '## Result\n\n- changed `src/app.ts`\n\n```ts\nconst ready = true\n```',
        createdAt: 1,
        state: 'complete',
      },
    }))

    expect(screen.getByRole('heading', { name: 'Result' })).toBeTruthy()
    expect(screen.getByText('src/app.ts')).toBeTruthy()
    expect(screen.getByText('const ready = true')).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制回答' })).toBeTruthy()
  })

  it('renders sent attachments and highlights project references', () => {
    render(createElement(Message, {
      message: {
        id: 'user-with-file',
        role: 'user',
        text: '@src/main.ts 请检查这个入口',
        createdAt: 1,
        state: 'complete',
        attachments: [{ id: 'sha256:file', name: 'brief.pdf', bytes: 1_536 }],
      },
    }))

    expect(screen.getByLabelText('附件 brief.pdf')).toBeTruthy()
    expect(screen.getByText('电脑文件 · 1.5 KB')).toBeTruthy()
    expect(screen.getByLabelText('项目文件引用 @src/main.ts')).toBeTruthy()
  })

  it('keeps a file-only user message visible', () => {
    render(createElement(Message, {
      message: {
        id: 'user-file-only',
        role: 'user',
        text: '',
        createdAt: 1,
        state: 'complete',
        attachments: [{ id: 'sha256:script', name: '1.py', bytes: 180 }],
      },
    }))

    expect(screen.getByLabelText('附件 1.py')).toBeTruthy()
    expect(screen.getByText('电脑文件 · 180 B')).toBeTruthy()
  })

  it('shows a localized failure when a model turn times out without an answer', () => {
    const messages = projectMessages([
      { type: 'step/start', seq: 1, time: 10, data: { turn: 1, step: 1 } },
      { type: 'assistant/attempt', seq: 2, time: 20, data: { turn: 1, step: 1, stream: [] } },
      { type: 'turn/end', seq: 3, time: 30, data: { turn: 1, reason: { kind: 'error', error: { code: 'TIMEOUT', message: 'internal detail' } } } },
    ])

    expect(messages[0]?.text).toBe('模型响应超时，请检查网络连接后重试。')
    render(createElement(Message, { message: messages[0]! }))
    expect(screen.getByText('回答失败')).toBeTruthy()
    expect(screen.queryByText('internal detail')).toBeNull()
  })

  it('does not append a failure card after a visible assistant answer', () => {
    const messages = projectMessages([
      { type: 'assistant/message', seq: 1, time: 10, data: { turn: 1, message: { id: 'answer', content: [{ type: 'text', text: '已完成可用部分。' }] } } },
      { type: 'turn/end', seq: 2, time: 20, data: { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'detail' } } } },
    ])

    expect(messages.map(message => message.text)).toEqual(['已完成可用部分。'])
  })

  it('adds a failure after commentary that only introduced a tool call', () => {
    const messages = projectMessages([
      {
        type: 'assistant/message',
        seq: 1,
        time: 10,
        data: {
          turn: 1,
          message: {
            id: 'commentary',
            content: [
              { type: 'text', text: '我先检查项目文件。' },
              { type: 'tool-call', id: 'read-1', name: 'read', arguments: '{}' },
            ],
          },
        },
      },
      { type: 'turn/end', seq: 2, time: 20, data: { turn: 1, reason: { kind: 'error', error: { code: 'TIMEOUT' } } } },
    ])

    expect(messages.map(message => [message.text, message.presentation])).toEqual([
      ['我先检查项目文件。', 'activity'],
      ['模型响应超时，请检查网络连接后重试。', 'answer'],
    ])
  })

  it('marks tool-call commentary separately from the final answer', () => {
    const messages = projectMessages([
      {
        type: 'assistant/message',
        seq: 1,
        time: 10,
        data: {
          turn: 1,
          message: {
            id: 'commentary',
            content: [
              { type: 'text', text: '先检查项目文件。' },
              { type: 'tool-call', id: 'read-1', name: 'read', arguments: '{}' },
            ],
          },
        },
      },
      {
        type: 'assistant/message',
        seq: 2,
        time: 20,
        data: { turn: 1, message: { id: 'answer', content: [{ type: 'text', text: '检查完成。' }] } },
      },
    ])

    expect(messages.map(message => message.presentation)).toEqual(['activity', 'answer'])
  })

  it('collects several operation rounds before starting the next visible group', () => {
    const commands = Array.from({ length: 6 }, (_, index) => ({
      id: `command-${String(index)}`,
      title: 'Bash',
      kind: 'terminal' as const,
      state: 'complete' as const,
      detail: '',
      createdAt: 20 + index,
      sequence: index < 3 ? index + 2 : index + 3,
    }))
    const view = render(createElement(ActivityCard, {
      tools: [
        ...commands,
        { id: 'read', title: 'Read', kind: 'read', state: 'complete', detail: '', path: 'src/latest.ts', createdAt: 40, sequence: 10 },
      ],
      messages: [
        { id: 'stage-1', role: 'assistant', text: '先完成这一轮检查。', createdAt: 10, state: 'complete', sequence: 1 },
        { id: 'stage-detail', role: 'assistant', text: '继续检查剩余项目。', createdAt: 24, state: 'complete', sequence: 5 },
        { id: 'stage-2', role: 'assistant', text: '检查完成，开始处理下一部分。', createdAt: 39, state: 'complete', sequence: 9 },
      ],
      active: false,
    }))

    expect(screen.getAllByRole('button', { name: /条命令|个文件/u })).toHaveLength(2)
    expect(screen.getByText('运行 6 条命令')).toBeTruthy()
    expect(screen.getByText('读取 1 个文件')).toBeTruthy()
    expect(screen.getByText('先完成这一轮检查。')).toBeTruthy()
    expect(screen.getByText('检查完成，开始处理下一部分。')).toBeTruthy()
    const intermediate = screen.getByText('继续检查剩余项目。')
    const collapsedDetails = intermediate.closest('.tool-batch-collapse')
    expect(collapsedDetails?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '运行 6 条命令' }))
    expect(collapsedDetails?.getAttribute('aria-hidden')).toBe('false')
  })

  it('aggregates consecutive completed tools into one compact timeline row', () => {
    const first = session().tools[0]!
    const second = { ...first, id: 'read-2', path: 'src/latest.ts', createdAt: 18 }
    render(createElement(ActivityCard, { tools: [first, second], active: false }))

    expect(screen.getByText('用时 0 秒')).toBeTruthy()
    expect(screen.getByText('读取 2 个文件')).toBeTruthy()
    expect(screen.queryByText('正在思考')).toBeNull()
    expect(screen.queryByRole('button', { name: '已读取 src/first.ts' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '读取 2 个文件' }))

    expect(screen.getAllByText('已读取')).toHaveLength(2)
    expect(screen.getByText('src/first.ts')).toBeTruthy()
    expect(screen.getByText('src/latest.ts')).toBeTruthy()
  })

  it('shows live tool activity without exposing internal tool names', () => {
    render(createElement(ToolStep, {
      tool: { id: 'fetch', title: 'web_fetch', kind: 'web', state: 'pending', detail: '', url: 'https://www.olympics.com/zh/news' },
    }))

    expect(screen.getByText('正在搜索网页')).toBeTruthy()
    expect(screen.getByText('https://www.olympics.com/zh/news')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.queryByText('web_fetch')).toBeNull()
  })

  it('shows only Thinking before the first activity arrives', () => {
    render(createElement(ActivityCard, { tools: [], active: true }))

    expect(screen.getByText('正在思考')).toBeTruthy()
    expect(screen.queryByText('Working')).toBeNull()
  })

  it('keeps the current action at its timeline position while work is in progress', () => {
    const tool = { ...session().tools[0]!, state: 'pending' as const }
    const view = render(createElement(ActivityCard, { tools: [tool], active: true }))
    expect(screen.getByRole('status').textContent).toBe('正在读取 src/first.ts')
    expect(screen.queryByText('正在思考')).toBeNull()

    view.rerender(createElement(ActivityCard, { tools: [{ ...tool, state: 'complete' }], active: false }))
    expect(screen.getByText('用时 0 秒')).toBeTruthy()
    expect(screen.getByText('读取 1 个文件')).toBeTruthy()
    expect(screen.queryByText('正在思考')).toBeNull()
  })

  it('keeps earlier stages visible until the final answer starts', () => {
    const turn = buildConversationTurns(session())[1]!
    turn.reasoning.push({ id: 'live', text: 'Now I should run the final verification.', createdAt: 45, state: 'streaming' })

    const view = render(createElement(ConversationTurnView, { turn, active: true }))

    expect(screen.getByRole('status').textContent).toBe('正在思考')
    expect(screen.getByRole('button', { name: '编辑 1 个文件' })).toBeTruthy()
    expect(screen.getByText('Done again')).toBeTruthy()
    expect(screen.queryByText('Next I should update the second file.')).toBeNull()
    expect(screen.queryByText('Now I should run the final verification.')).toBeNull()

    turn.assistants = [{ ...turn.assistants[0]!, state: 'streaming', presentation: 'answer' }]
    view.rerender(createElement(ConversationTurnView, { turn, active: true }))

    expect(screen.queryByText('正在思考')).toBeNull()
    expect(screen.getByRole('button', { name: '编辑 1 个文件' })).toBeTruthy()
    expect(view.container.querySelector('.turn-timeline > .assistant-message.streaming')?.textContent).toContain('Done again')
  })

  it('shows every commentary stage in order and one current Thinking placeholder', () => {
    const reasoning = Array.from({ length: 25 }, (_, index) => ({
      id: `reasoning-${String(index)}`,
      text: `Inspect source file ${String(index)} and trace the implementation.`,
      createdAt: (index + 1) * 10,
      state: 'complete' as const,
    }))
    const messages = Array.from({ length: 5 }, (_, index) => ({
      id: `stage-${String(index)}`,
      role: 'assistant' as const,
      text: `Stage ${String(index + 1)}`,
      createdAt: (index + 1) * 50 + 5,
      state: 'complete' as const,
    }))

    render(createElement(ActivityCard, { tools: [], reasoning, messages, active: true }))

    expect(screen.getAllByText('正在思考')).toHaveLength(1)
    expect(screen.queryByText('Inspect source file 24 and trace the implementation.')).toBeNull()
    expect(screen.getByText('Stage 1')).toBeTruthy()
    expect(screen.getByText('Stage 5')).toBeTruthy()
  })

  it('shows completed commentary while omitting standalone reasoning rows', () => {
    const reasoning = Array.from({ length: 25 }, (_, index) => ({
      id: `completed-reasoning-${String(index)}`,
      text: `Review source file ${String(index)} and check the implementation.`,
      createdAt: (index + 1) * 10,
      state: 'complete' as const,
    }))
    const messages = Array.from({ length: 5 }, (_, index) => ({
      id: `completed-stage-${String(index)}`,
      role: 'assistant' as const,
      text: `Completed stage ${String(index + 1)}`,
      createdAt: (index + 1) * 50 + 5,
      state: 'complete' as const,
    }))
    reasoning.push({
      id: 'trailing-reasoning',
      text: 'Verify the remaining edge case.',
      createdAt: 270,
      state: 'complete',
    })

    render(createElement(ActivityCard, { tools: [], reasoning, messages, active: false }))

    expect(screen.queryByText('正在思考')).toBeNull()
    expect(screen.getByText('用时 0 秒')).toBeTruthy()
    expect(screen.getByText('Completed stage 1')).toBeTruthy()
    expect(screen.getByText('Completed stage 5')).toBeTruthy()
    expect(screen.queryByText('Verify the remaining edge case.')).toBeNull()
  })
})
