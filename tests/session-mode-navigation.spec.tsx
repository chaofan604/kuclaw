// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexApp, DailyList, ModeMenu, ProjectList } from '../src/renderer/CodexApp.js'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('session mode navigation', () => {
  it('offers daily and project modes with clear outcomes', () => {
    const onSelect = vi.fn()
    render(<ModeMenu active="daily" onSelect={onSelect} onClose={() => undefined} />)

    expect(screen.getByText('日常工作模式')).toBeTruthy()
    expect(screen.getByText('创建、整理和探索')).toBeTruthy()
    expect(screen.getByText('工程开发模式')).toBeTruthy()
    expect(screen.getByText('构建、调试和发布')).toBeTruthy()

    fireEvent.click(screen.getByText('工程开发模式'))
    expect(onSelect).toHaveBeenCalledWith('project')
  })

  it('creates another session inside an existing project without selecting its folder again', () => {
    const onCreateSession = vi.fn()
    const onSelect = vi.fn()
    const { container } = render(
      <ProjectList
        sessions={[{
          id: 'session-1',
          scope: 'project',
          title: '修复登录页',
          cwd: '/work/customer-portal',
          updatedAt: 1,
          status: 'idle',
          preview: '空会话',
        }]}
        currentId="session-1"
        onSelect={onSelect}
        onCreateSession={onCreateSession}
        onDelete={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '在 customer-portal 中新建会话' }))
    expect(onCreateSession).toHaveBeenCalledWith('/work/customer-portal')
    expect(onSelect).not.toHaveBeenCalled()

    expect(container.querySelector('.project-folder-icon.open')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起 customer-portal 的会话' }))
    expect(screen.queryByRole('button', { name: '修复登录页' })).toBeNull()
    expect(container.querySelector('.project-folder-icon.closed')).toBeTruthy()
    expect(container.querySelector('.project-folder-icon.open')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开 customer-portal 的会话' }))
    expect(screen.getByRole('button', { name: '修复登录页' })).toBeTruthy()
    expect(container.querySelector('.project-folder-icon.open')).toBeTruthy()
  })

  it('keeps project groups in place when session activity reorders the source list', () => {
    const first = {
      id: 'session-a', scope: 'project' as const, title: '任务 A', cwd: '/work/alpha',
      updatedAt: 2, status: 'idle' as const, preview: 'A',
    }
    const second = {
      id: 'session-b', scope: 'project' as const, title: '任务 B', cwd: '/work/beta',
      updatedAt: 1, status: 'idle' as const, preview: 'B',
    }
    const props = {
      currentId: undefined,
      onSelect: () => undefined,
      onCreateSession: () => undefined,
      onDelete: () => undefined,
    }
    const { container, rerender } = render(<ProjectList {...props} sessions={[first, second]} />)
    const projectNames = () => [...container.querySelectorAll('.project-toggle > span:last-child')]
      .map(element => element.textContent)

    expect(projectNames()).toEqual(['alpha', 'beta'])
    rerender(<ProjectList {...props} sessions={[{ ...second, updatedAt: 3 }, first]} currentId={second.id} />)
    expect(projectNames()).toEqual(['alpha', 'beta'])
  })

  it('shows session delete controls in both work modes without selecting the row', () => {
    const projectDelete = vi.fn()
    const projectSelect = vi.fn()
    const projectSession = {
      id: 'project-session',
      scope: 'project' as const,
      title: '修复登录页',
      cwd: '/work/customer-portal',
      updatedAt: 1,
      status: 'idle' as const,
      preview: '空会话',
    }
    const { unmount } = render(
      <ProjectList
        sessions={[projectSession]}
        currentId={projectSession.id}
        onSelect={projectSelect}
        onCreateSession={() => undefined}
        onDelete={projectDelete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '删除会话「修复登录页」' }))
    expect(projectDelete).toHaveBeenCalledWith(projectSession.id)
    expect(projectSelect).not.toHaveBeenCalled()

    unmount()
    const dailyDelete = vi.fn()
    render(
      <DailyList
        sessions={[{
          ...projectSession,
          id: 'daily-session',
          scope: 'daily',
          title: '整理今日计划',
          status: 'running',
        }]}
        currentId="daily-session"
        onSelect={() => undefined}
        onDelete={dailyDelete}
      />,
    )

    const runningDelete = screen.getByRole('button', { name: '会话正在运行，暂时无法删除「整理今日计划」' })
    expect(runningDelete.hasAttribute('disabled')).toBe(true)
    fireEvent.click(runningDelete)
    expect(dailyDelete).not.toHaveBeenCalled()
  })

  it('shows a flat product model list without provider or protocol labels', async () => {
    const session = {
      id: 'session-1',
      scope: 'daily' as const,
      title: '产品规划',
      cwd: '/tmp/daily',
      createdAt: 1,
      updatedAt: 1,
      status: 'idle' as const,
      modelSelection: { provider: 'glm', model: 'glm-5.3-flash' },
      permissionSelection: {
        options: [
          { value: 'workspace-write', name: '工作区写入' },
          { value: 'danger-full-access', name: '完全访问' },
        ],
        currentValue: 'workspace-write',
      },
      messages: [],
      tools: [],
      jobs: [],
    }
    const selectPermission = vi.fn().mockResolvedValue({
      ...session.permissionSelection,
      currentValue: 'danger-full-access',
    })
    Object.defineProperty(window, 'harnessStudio', {
      configurable: true,
      value: {
        application: { onOpenSettings: vi.fn(() => () => undefined) },
        sessions: {
          list: vi.fn().mockResolvedValue([{
            id: session.id,
            scope: session.scope,
            title: session.title,
            cwd: session.cwd,
            updatedAt: session.updatedAt,
            status: session.status,
            preview: '空会话',
          }]),
          get: vi.fn().mockResolvedValue(session),
        },
        models: {
          getConfiguration: vi.fn().mockResolvedValue({
            defaultSelection: session.modelSelection,
            profiles: [{ id: 'glm' }, { id: 'openai' }],
            groups: [
              { id: 'glm', name: 'OpenAI Responses 兼容接口', models: [{ id: 'glm-5.3-flash', name: 'glm-5.3-flash', reasoningEfforts: [] }] },
              { id: 'openai', name: 'OpenAI Responses 兼容接口', models: [{ id: 'openai.gpt-5.6-sol', name: 'openai.gpt-5.6-sol', reasoningEfforts: [] }] },
            ],
          }),
        },
        permissions: {
          listPending: vi.fn().mockResolvedValue([]),
          get: vi.fn().mockResolvedValue(session.permissionSelection),
          select: selectPermission,
        },
        context: { get: vi.fn().mockResolvedValue(undefined) },
        runtime: {
          mode: vi.fn().mockResolvedValue('harness'),
          status: vi.fn().mockResolvedValue({ phase: 'ready' }),
          subscribe: vi.fn(() => () => undefined),
        },
      },
    })
    render(<CodexApp />)

    fireEvent.click(await screen.findByRole('button', { name: '产品规划' }))
    const picker = await screen.findByRole('button', { name: 'glm-5.3-flash' })
    fireEvent.click(picker)

    expect(screen.queryByText('OpenAI Responses 兼容接口')).toBeNull()
    expect(screen.getByRole('button', { name: 'openai.gpt-5.6-sol' })).toBeTruthy()
    expect(screen.getAllByText('glm-5.3-flash')).toHaveLength(2)

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('button', { name: 'openai.gpt-5.6-sol' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '工作区写入' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '完全访问' }))
    })
    expect(selectPermission).toHaveBeenCalledWith(session.id, 'danger-full-access')
    expect(screen.queryByRole('menuitem', { name: '完全访问' })).toBeNull()
    expect(screen.getByRole('button', { name: '工作区写入' })).toBeTruthy()
  })

  it('restores the selected daily session after the renderer reloads', async () => {
    localStorage.setItem('harness-studio:session-view-state', JSON.stringify({
      scope: 'daily',
      selected: { daily: 'session-2' },
    }))
    const session = {
      id: 'session-2',
      scope: 'daily' as const,
      title: '保留的日常会话',
      cwd: '/tmp/daily',
      createdAt: 1,
      updatedAt: 2,
      status: 'idle' as const,
      messages: [{
        id: 'message-1',
        role: 'user' as const,
        text: '重启后仍然可见',
        createdAt: 1,
        state: 'complete' as const,
      }],
      tools: [],
      jobs: [],
    }
    const get = vi.fn().mockResolvedValue(session)
    Object.defineProperty(window, 'harnessStudio', {
      configurable: true,
      value: {
        application: { onOpenSettings: vi.fn(() => () => undefined) },
        sessions: {
          list: vi.fn().mockResolvedValue([{
            id: session.id,
            scope: session.scope,
            title: session.title,
            cwd: session.cwd,
            updatedAt: session.updatedAt,
            status: session.status,
            preview: session.messages[0].text,
          }]),
          get,
        },
        models: { getConfiguration: vi.fn().mockResolvedValue(undefined) },
        permissions: {
          listPending: vi.fn().mockResolvedValue([]),
          get: vi.fn().mockResolvedValue(undefined),
        },
        context: { get: vi.fn().mockResolvedValue(undefined) },
        runtime: {
          mode: vi.fn().mockResolvedValue('harness'),
          status: vi.fn().mockResolvedValue({ phase: 'ready' }),
          subscribe: vi.fn(() => () => undefined),
        },
      },
    })

    render(<CodexApp />)

    await screen.findByText('重启后仍然可见')
    await waitFor(() => expect(get).toHaveBeenCalledWith('daily', 'session-2'))
    expect(screen.getByRole('textbox', { name: '输入消息' }).hasAttribute('disabled')).toBe(false)
  })

  it('removes the selected daily session and opens the next available conversation', async () => {
    const summaries = [
      {
        id: 'session-2', scope: 'daily' as const, title: '最新对话', cwd: '/tmp/daily',
        updatedAt: 2, status: 'idle' as const, preview: '最新内容',
      },
      {
        id: 'session-1', scope: 'daily' as const, title: '较早对话', cwd: '/tmp/daily',
        updatedAt: 1, status: 'idle' as const, preview: '保留内容',
      },
    ]
    const records = new Map(summaries.map(summary => [summary.id, {
      ...summary,
      createdAt: summary.updatedAt,
      messages: [{
        id: `message-${summary.id}`,
        role: 'user' as const,
        text: summary.preview,
        createdAt: summary.updatedAt,
        state: 'complete' as const,
      }],
      tools: [],
      jobs: [],
    }]))
    const remove = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'harnessStudio', {
      configurable: true,
      value: {
        application: { onOpenSettings: vi.fn(() => () => undefined) },
        sessions: {
          list: vi.fn().mockResolvedValue(summaries),
          get: vi.fn((_scope: string, id: string) => Promise.resolve(records.get(id))),
          delete: remove,
        },
        models: { getConfiguration: vi.fn().mockResolvedValue(undefined) },
        permissions: {
          listPending: vi.fn().mockResolvedValue([]),
          get: vi.fn().mockResolvedValue(undefined),
        },
        context: { get: vi.fn().mockResolvedValue(undefined) },
        runtime: {
          mode: vi.fn().mockResolvedValue('harness'),
          status: vi.fn().mockResolvedValue({ phase: 'ready' }),
          subscribe: vi.fn(() => () => undefined),
        },
      },
    })
    render(<CodexApp />)

    await screen.findByText('最新内容')
    fireEvent.click(screen.getByRole('button', { name: '删除会话「最新对话」' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('daily', 'session-2'))
    expect(await screen.findByText('保留内容')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '最新对话' })).toBeNull()
    expect(JSON.parse(localStorage.getItem('harness-studio:session-view-state') ?? '{}')).toMatchObject({
      scope: 'daily',
      selected: { daily: 'session-1' },
    })
  })

  it('shows progress and an actionable error when project session creation fails', async () => {
    let rejectCreation: ((reason: Error) => void) | undefined
    const create = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {
      rejectCreation = reject
    }))
    const projectSession = {
      id: 'session-1',
      scope: 'project' as const,
      title: '修复登录页',
      cwd: '/work/customer-portal',
      updatedAt: 1,
      status: 'idle' as const,
      preview: '空会话',
    }
    Object.defineProperty(window, 'harnessStudio', {
      configurable: true,
      value: {
        application: { onOpenSettings: vi.fn(() => () => undefined) },
        sessions: {
          list: vi.fn((scope: string) => Promise.resolve(scope === 'project' ? [projectSession] : [])),
          get: vi.fn().mockResolvedValue(undefined),
          create,
        },
        models: { getConfiguration: vi.fn().mockResolvedValue(undefined) },
        permissions: { listPending: vi.fn().mockResolvedValue([]) },
        runtime: {
          mode: vi.fn().mockResolvedValue('harness'),
          status: vi.fn().mockResolvedValue({ phase: 'ready' }),
          subscribe: vi.fn(() => () => undefined),
        },
      },
    })
    render(<CodexApp />)

    fireEvent.click(screen.getByRole('button', { name: /日常工作/u }))
    fireEvent.click(screen.getByText('工程开发模式'))
    const addButton = await screen.findByRole('button', { name: '在 customer-portal 中新建会话' })
    fireEvent.click(addButton)

    expect(create).toHaveBeenCalledWith('project', '/work/customer-portal')
    expect(screen.getByRole('button', { name: '正在 customer-portal 中新建会话' }).hasAttribute('disabled')).toBe(true)

    await act(async () => rejectCreation?.(new Error(
      'session header cwd must be an absolute path, got "project"',
    )))

    expect(await screen.findByText('新建任务失败，请确认项目文件夹仍可访问，然后重试。')).toBeTruthy()
    expect(screen.queryByText(/session header|absolute path/iu)).toBeNull()
  })

  it.each([
    {
      mode: 'goal' as const,
      modeLabel: '目标',
      placeholder: '描述你的目标，定义可衡量的成果…',
      status: { goalStatus: { objective: '持续交付产品', phase: 'active' as const, roundsStarted: 1 } },
      exitText: 'clear',
    },
    {
      mode: 'plan' as const,
      modeLabel: '计划',
      placeholder: '描述你的任务以生成计划…',
      status: { planStatus: { active: true, pending: false } },
      exitText: 'off',
    },
  ])('restores persistent $mode mode and keeps it after a follow-up message', async ({
    mode, modeLabel, placeholder, status, exitText,
  }) => {
    const session = {
      id: `session-${mode}`,
      scope: 'daily' as const,
      title: `${modeLabel}会话`,
      cwd: '/tmp/daily',
      createdAt: 1,
      updatedAt: 1,
      status: 'idle' as const,
      messages: [],
      tools: [],
      jobs: [],
      ...status,
    }
    const run = vi.fn().mockResolvedValue({ messageId: 'message-1' })
    const command = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'harnessStudio', {
      configurable: true,
      value: {
        application: { onOpenSettings: vi.fn(() => () => undefined) },
        sessions: {
          list: vi.fn().mockResolvedValue([{
            id: session.id,
            scope: session.scope,
            title: session.title,
            cwd: session.cwd,
            updatedAt: session.updatedAt,
            status: session.status,
            preview: '空会话',
          }]),
          get: vi.fn().mockResolvedValue(session),
          run,
          command,
        },
        models: { getConfiguration: vi.fn().mockResolvedValue(undefined) },
        permissions: {
          listPending: vi.fn().mockResolvedValue([]),
          get: vi.fn().mockResolvedValue(undefined),
        },
        context: { get: vi.fn().mockResolvedValue(undefined) },
        runtime: {
          mode: vi.fn().mockResolvedValue('harness'),
          status: vi.fn().mockResolvedValue({ phase: 'ready' }),
          subscribe: vi.fn(() => () => undefined),
        },
      },
    })
    render(<CodexApp />)

    const modeButton = await screen.findByRole('button', { name: `退出${modeLabel}模式` })
    const input = screen.getByRole('textbox', { name: '输入消息' })
    expect(input.getAttribute('placeholder')).toBe(placeholder)

    fireEvent.change(input, { target: { value: '继续完成这个任务' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith('daily', session.id, {
      text: '继续完成这个任务',
      references: [],
      attachments: [],
    }))
    expect(screen.getByRole('button', { name: `退出${modeLabel}模式` })).toBeTruthy()

    fireEvent.click(modeButton)
    await waitFor(() => expect(command).toHaveBeenCalledWith('daily', session.id, {
      command: mode,
      text: exitText,
      references: [],
      attachments: [],
    }))
  })
})
