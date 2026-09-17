// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScheduledTasksPage } from '../src/renderer/ScheduledTasksPage.js'
import type { ModelConfiguration, ScheduledTask, ScheduledTaskRun } from '../src/shared/contracts.js'

const MODEL_OPTION = 'group-a\x00model-one'

const modelConfiguration: ModelConfiguration = {
  available: true,
  writable: true,
  credentialConfigured: true,
  credentialWritable: true,
  baseURL: 'https://api.deepseek.com',
  maxTokens: 256_000,
  defaultSelection: { provider: 'group-a', model: 'model-one' },
  groups: [{
    id: 'group-a',
    name: 'DeepSeek 官方',
    models: [{ id: 'model-one', name: 'model-one', reasoningEfforts: [] }],
  }],
  profiles: [],
  failures: [],
}

const task: ScheduledTask = {
  id: 'task-1',
  name: '每日代码检查',
  workspacePath: '/Users/demo/project',
  cron: '0 1 * * *',
  timeZone: 'Asia/Shanghai',
  prompt: '检查最近的变更并给出风险报告。',
  model: { provider: 'group-a', model: 'model-one' },
  preset: '',
  enabled: true,
  concurrency: 'skip',
  missedRunPolicy: 'skip',
  nextRunAt: Date.UTC(2026, 0, 10, 17, 0),
  createdAt: Date.UTC(2026, 0, 9, 17, 0),
  updatedAt: Date.UTC(2026, 0, 9, 17, 0),
}

const run: ScheduledTaskRun = {
  id: 'run-1',
  taskId: 'task-1',
  scheduledAt: Date.UTC(2026, 0, 9, 17, 0),
  sessionId: 'session-1',
  status: 'succeeded',
  startedAt: Date.UTC(2026, 0, 9, 17, 0),
  finishedAt: Date.UTC(2026, 0, 9, 17, 5),
}

function mockApi() {
  const api = {
    scheduledTasks: {
      list: vi.fn().mockResolvedValue([task]),
      listRuns: vi.fn().mockResolvedValue([run]),
      subscribe: vi.fn().mockReturnValue(vi.fn()),
      create: vi.fn().mockResolvedValue(task),
      update: vi.fn().mockResolvedValue(task),
      setEnabled: vi.fn().mockResolvedValue(task),
      runNow: vi.fn().mockResolvedValue(run),
      remove: vi.fn().mockResolvedValue(undefined),
      cancelRun: vi.fn().mockResolvedValue(undefined),
    },
    workspace: { pick: vi.fn().mockResolvedValue(undefined) },
  }
  Object.defineProperty(window, 'harnessStudio', { configurable: true, value: api })
  return api
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ScheduledTasksPage', () => {
  it('opens run history from the task card instead of rendering it beside the list', async () => {
    const api = mockApi()
    render(<ScheduledTasksPage modelConfiguration={modelConfiguration} onOpenSession={vi.fn()} />)
    expect(await screen.findByText('每日代码检查')).toBeDefined()
    expect(screen.getByText('Asia/Shanghai', { selector: '.scheduled-card-schedule i' })).toBeDefined()
    expect(screen.queryByRole('dialog', { name: '每日代码检查 运行历史' })).toBeNull()
    expect(api.scheduledTasks.listRuns).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '运行历史' }))
    expect(await screen.findByRole('dialog', { name: '每日代码检查 运行历史' })).toBeDefined()
    expect(await screen.findByText('成功')).toBeDefined()
    expect(api.scheduledTasks.listRuns).toHaveBeenCalledWith('task-1', 50)
  })

  it('creates a task from the editor form', async () => {
    const api = mockApi()
    api.workspace.pick = vi.fn().mockResolvedValue('/Users/demo/picked')
    render(<ScheduledTasksPage modelConfiguration={modelConfiguration} onOpenSession={vi.fn()} />)
    fireEvent.click(await screen.findByText('创建定时任务'))
    expect(document.querySelector('.scheduled-timing-grid')).toBeTruthy()
    expect(screen.getByText('格式：分 时 日 月 周')).toBeDefined()
    expect(screen.getByText('IANA 时区，例如 Asia/Shanghai')).toBeDefined()

    fireEvent.change(screen.getByPlaceholderText('每日代码检查'), { target: { value: '每周巡检' } })
    fireEvent.click(screen.getByText('选择…'))
    await waitFor(() => expect(api.workspace.pick).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText('检查项目最近的变更，运行测试并给出风险报告。'), { target: { value: '运行测试并汇报。' } })
    fireEvent.change(screen.getByLabelText('运行模型'), { target: { value: MODEL_OPTION } })
    fireEvent.click(screen.getByText('保存任务'))

    await waitFor(() => expect(api.scheduledTasks.create).toHaveBeenCalledTimes(1))
    expect(api.scheduledTasks.create).toHaveBeenCalledWith(expect.objectContaining({
      name: '每周巡检',
      workspacePath: '/Users/demo/picked',
      cron: '0 1 * * *',
      timeZone: expect.any(String),
      prompt: '运行测试并汇报。',
      model: { provider: 'group-a', model: 'model-one' },
    }))
    expect(api.scheduledTasks.create.mock.calls[0]?.[0]).not.toHaveProperty('preset')
  })

  it('surfaces save failures from the host', async () => {
    const api = mockApi()
    api.scheduledTasks.create = vi.fn().mockRejectedValue(new Error('Cron 表达式必须包含 5 个字段'))
    render(<ScheduledTasksPage modelConfiguration={modelConfiguration} onOpenSession={vi.fn()} />)
    fireEvent.click(await screen.findByText('创建定时任务'))
    fireEvent.change(screen.getByPlaceholderText('每日代码检查'), { target: { value: '坏任务' } })
    fireEvent.change(screen.getByPlaceholderText('检查项目最近的变更，运行测试并给出风险报告。'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('运行模型'), { target: { value: MODEL_OPTION } })
    fireEvent.click(screen.getByText('保存任务'))
    expect(await screen.findByText('Cron 表达式必须包含 5 个字段')).toBeDefined()
  })

  it('opens the session of a finished run', async () => {
    mockApi()
    const onOpenSession = vi.fn()
    render(<ScheduledTasksPage modelConfiguration={modelConfiguration} onOpenSession={onOpenSession} />)
    fireEvent.click(await screen.findByRole('button', { name: '运行历史' }))
    fireEvent.click(await screen.findByText('打开 Session'))
    expect(onOpenSession).toHaveBeenCalledWith('session-1')
  })

  it('closes the run history layout', async () => {
    mockApi()
    render(<ScheduledTasksPage modelConfiguration={modelConfiguration} onOpenSession={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '运行历史' }))
    expect(await screen.findByRole('dialog', { name: '每日代码检查 运行历史' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '关闭运行历史' }))
    expect(screen.queryByRole('dialog', { name: '每日代码检查 运行历史' })).toBeNull()
  })
})
