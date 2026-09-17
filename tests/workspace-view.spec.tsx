// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexApp } from '../src/renderer/CodexApp.js'

const session = {
  id: 'workspace-session',
  scope: 'project' as const,
  title: '真实项目视图',
  cwd: '/workspace/project',
  createdAt: 1,
  updatedAt: 1,
  status: 'idle' as const,
  messages: [],
  tools: [],
  jobs: [],
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  localStorage.setItem('harness-studio:session-view-state', JSON.stringify({
    scope: 'project',
    selected: { project: session.id },
  }))
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('project workspace views', () => {
  it('shows real changes, opens a live diff, and reads selected files from the project tree', async () => {
    const changes = vi.fn().mockResolvedValue({
      isRepository: true,
      branch: 'feature/live-workspace',
      additions: 2,
      deletions: 1,
      files: [{ path: 'src/app.ts', kind: 'modified', staged: false, additions: 2, deletions: 1 }],
    })
    const diff = vi.fn().mockResolvedValue({
      path: 'src/app.ts',
      kind: 'modified',
      additions: 2,
      deletions: 1,
      patch: '@@ -1 +1,2 @@\n-old value\n+new value\n+next line',
    })
    const listDirectory = vi.fn((_: string, __: string, path = '') => Promise.resolve(path === ''
      ? [{ path: 'src', name: 'src', kind: 'directory' }]
      : [{ path: 'src/app.ts', name: 'app.ts', kind: 'file' }]))
    const readFile = vi.fn().mockResolvedValue({
      path: 'src/app.ts',
      content: 'export const value = 2\n',
      bytes: 23,
      truncated: false,
      binary: false,
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
        models: { getConfiguration: vi.fn().mockResolvedValue(undefined) },
        permissions: { listPending: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(undefined) },
        context: { get: vi.fn().mockResolvedValue(undefined) },
        workspace: { changes, diff, listDirectory, readFile },
        runtime: {
          mode: vi.fn().mockResolvedValue('harness'),
          status: vi.fn().mockResolvedValue({ phase: 'ready' }),
          subscribe: vi.fn(() => () => undefined),
        },
      },
    })

    render(<CodexApp />)

    expect(await screen.findByText('feature/live-workspace')).toBeTruthy()
    expect(screen.queryByText('来源')).toBeNull()
    expect(screen.getByText('+2')).toBeTruthy()
    expect(screen.getByText('−1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /变更/u }))
    fireEvent.click(await screen.findByRole('button', { name: /src\/app\.ts/u }))
    expect(await screen.findByText('+new value')).toBeTruthy()
    expect(screen.getByText('-old value')).toBeTruthy()
    await waitFor(() => expect(diff).toHaveBeenCalledWith('project', session.id, 'src/app.ts'))

    fireEvent.click(screen.getByRole('button', { name: /^文件/u }))
    fireEvent.click(await screen.findByRole('button', { name: 'src' }))
    fireEvent.click(await screen.findByRole('button', { name: 'app.ts' }))
    expect(await screen.findByLabelText('第 1 行：export const value = 2')).toBeTruthy()
    expect(screen.getByText('TypeScript')).toBeTruthy()
    await waitFor(() => expect(readFile).toHaveBeenCalledWith('project', session.id, 'src/app.ts'))
  })
})
