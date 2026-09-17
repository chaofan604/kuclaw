// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexApp } from '../src/renderer/CodexApp.js'
import type { ModelConfiguration } from '../src/shared/contracts.js'

const session = {
  id: 'session-composer',
  scope: 'project' as const,
  title: 'Composer test',
  cwd: '/workspace/project',
  createdAt: 1,
  updatedAt: 1,
  status: 'idle' as const,
  messages: [],
  tools: [],
  jobs: [],
}

const modelConfiguration: ModelConfiguration = {
  available: true,
  writable: true,
  credentialConfigured: true,
  credentialWritable: true,
  baseURL: 'https://models.example.test',
  maxTokens: 8192,
  defaultSelection: { provider: 'provider-a', model: 'model-a' },
  groups: [{
    id: 'provider-a',
    name: 'Provider A',
    models: [
      {
        id: 'model-a',
        name: 'Model A',
        reasoningEfforts: [
          { id: 'off', name: 'Off' },
          { id: 'low', name: 'Low' },
          { id: 'high', name: 'High' },
        ],
        defaultReasoningEffort: 'high',
      },
      {
        id: 'model-b',
        name: 'Model B',
        reasoningEfforts: [
          { id: 'minimal', name: 'Minimal' },
          { id: 'medium', name: 'Medium' },
          { id: 'xhigh', name: 'Extra high' },
        ],
        defaultReasoningEffort: 'medium',
      },
    ],
  }],
  profiles: [{
    id: 'provider-a',
    displayName: 'Provider A',
    protocol: 'openai-responses',
    baseURL: 'https://models.example.test',
    credentialConfigured: true,
    credentialWritable: true,
    models: [
      { id: 'model-a', name: 'Model A', contextWindow: 128000, maxTokens: 8192 },
      { id: 'model-b', name: 'Model B', contextWindow: 128000, maxTokens: 8192 },
    ],
  }],
  failures: [],
}

function installApi(overrides: {
  run?: ReturnType<typeof vi.fn>
  command?: ReturnType<typeof vi.fn>
  compact?: ReturnType<typeof vi.fn>
  contextGet?: ReturnType<typeof vi.fn>
  pickFiles?: ReturnType<typeof vi.fn>
  pasteImage?: ReturnType<typeof vi.fn>
  uploadImage?: ReturnType<typeof vi.fn>
  files?: ReturnType<typeof vi.fn>
  selectModel?: ReturnType<typeof vi.fn>
  modelConfiguration?: ModelConfiguration
} = {}) {
  const run = overrides.run ?? vi.fn().mockResolvedValue({ messageId: 'message-1' })
  const command = overrides.command ?? vi.fn().mockResolvedValue(undefined)
  const compact = overrides.compact ?? vi.fn().mockResolvedValue({ status: 'complete' })
  const contextGet = overrides.contextGet ?? vi.fn().mockResolvedValue(undefined)
  const pickFiles = overrides.pickFiles ?? vi.fn().mockResolvedValue([])
  const pasteImage = overrides.pasteImage ?? vi.fn().mockResolvedValue(undefined)
  const uploadImage = overrides.uploadImage ?? vi.fn().mockResolvedValue({
    receiptId: 'image-receipt',
    name: 'pasted-image.png',
    bytes: 4,
  })
  const files = overrides.files ?? vi.fn().mockResolvedValue([])
  const selectModel = overrides.selectModel ?? vi.fn().mockImplementation((_scope, _id, selection) => Promise.resolve(selection))
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
        selectModel,
        command,
        commands: vi.fn().mockResolvedValue([
          { name: 'goal', description: 'Set or view the goal for a long-running task' },
          { name: 'plan', description: 'Enter or leave plan mode' },
          { name: 'review', description: '检查当前改动' },
          { name: 'compact', description: '压缩当前上下文' },
          { name: 'export', description: '导出当前会话' },
          { name: 'feedback', description: '提交反馈' },
          { name: 'permission', description: '切换权限模式' },
        ]),
      },
      skills: {
        list: vi.fn().mockResolvedValue([{
          name: 'agent-browser',
          description: '浏览器自动化',
          userInvocable: true,
          modelInvocable: true,
          enabled: true,
          managed: false,
          source: 'workspace',
        }]),
      },
      mcp: {
        list: vi.fn().mockResolvedValue([{
          id: 'docs',
          serverName: '文档服务',
          transport: 'stdio',
          enabled: true,
          toolCallTimeoutMs: 30_000,
          status: 'ready',
          toolCount: 3,
        }]),
      },
      models: { getConfiguration: vi.fn().mockResolvedValue(overrides.modelConfiguration) },
      permissions: {
        listPending: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(undefined),
      },
      context: { get: contextGet, compact },
      workspace: { pickFiles, pasteImage, uploadImage, files },
      runtime: {
        mode: vi.fn().mockResolvedValue('harness'),
        status: vi.fn().mockResolvedValue({ phase: 'ready' }),
        subscribe: vi.fn(() => () => undefined),
      },
    },
  })
  return { run, command, compact, contextGet, pickFiles, pasteImage, uploadImage, files, selectModel }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:harness-studio-preview'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
  localStorage.setItem('harness-studio:session-view-state', JSON.stringify({
    scope: 'project',
    selected: { project: session.id },
  }))
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('structured composer entities', () => {
  it('closes the model menu immediately while the Host applies the selected model', async () => {
    const selectModel = vi.fn(() => new Promise(() => undefined))
    installApi({ selectModel, modelConfiguration })
    render(<CodexApp />)

    const picker = await screen.findByRole('button', { name: 'Model A' })
    fireEvent.click(picker)
    const option = await screen.findByRole('button', { name: 'Model B' })
    fireEvent.click(option)

    expect(selectModel).toHaveBeenCalledWith('project', session.id, {
      provider: 'provider-a',
      model: 'model-b',
      reasoningEffort: 'medium',
    })
    expect(screen.queryByRole('menu', { name: '模型列表' })).toBeNull()
    expect(picker.getAttribute('aria-busy')).toBe('true')
  })

  it('offers only the reasoning efforts declared by the active model', async () => {
    const api = installApi({ modelConfiguration })
    render(<CodexApp />)

    fireEvent.click(await screen.findByRole('button', { name: 'High' }))
    expect(screen.getByRole('button', { name: 'Off' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Low' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Low' }))
    await waitFor(() => expect(api.selectModel).toHaveBeenCalledWith('project', session.id, {
      provider: 'provider-a',
      model: 'model-a',
      reasoningEffort: 'low',
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Model A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Model B' }))
    await screen.findByRole('button', { name: 'Medium' })
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }))
    expect(screen.getByRole('button', { name: 'Minimal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Extra High' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Low' })).toBeNull()
  })

  it('opens Finder first for @, presents the uploaded file as a removable entity, and sends an attachment receipt', async () => {
    const pickFiles = vi.fn().mockResolvedValue([{ receiptId: 'receipt-1', name: 'brief.pdf', bytes: 2_048 }])
    const { run } = installApi({ pickFiles })
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } })
    const finder = await screen.findByRole('option', { name: /选择文件/u })
    expect(finder.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(pickFiles).toHaveBeenCalledWith('project', session.id))
    expect(await screen.findByText('brief.pdf')).toBeTruthy()
    expect(screen.getByText('电脑文件 · 2.0 KB')).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe('')

    fireEvent.change(input, { target: { value: '总结这份文件', selectionStart: 6 } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith('project', session.id, {
      text: '总结这份文件',
      references: [],
      attachments: [{ receiptId: 'receipt-1', name: 'brief.pdf', bytes: 2_048 }],
    }))
  })

  it('pastes an image as a preview and sends its staged Harness receipt', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    const image = new File([bytes], 'screenshot.png', { type: 'image/png' })
    Object.defineProperty(image, 'arrayBuffer', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bytes.buffer),
    })
    const uploadImage = vi.fn().mockResolvedValue({
      receiptId: 'receipt-image',
      name: 'screenshot.png',
      bytes: bytes.byteLength,
    })
    const { run } = installApi({ uploadImage })
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.paste(input, {
      clipboardData: {
        types: ['image/png'],
        getData: () => '',
        items: [{
          kind: 'file',
          type: 'image/png',
          getAsFile: () => image,
        }],
      },
    })

    await waitFor(() => expect(uploadImage).toHaveBeenCalledWith('project', session.id, {
      name: 'screenshot.png',
      mediaType: 'image/png',
      bytes,
    }))
    expect(await screen.findByRole('img', { name: 'screenshot.png' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '移除图片 screenshot.png' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith('project', session.id, {
      text: '',
      references: [],
      attachments: [{ receiptId: 'receipt-image', name: 'screenshot.png', bytes: 4 }],
    }))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:harness-studio-preview')
  })

  it('hides transport details when a clipboard image upload fails', async () => {
    const image = new File([new Uint8Array([1, 2, 3])], 'screenshot.png', { type: 'image/png' })
    Object.defineProperty(image, 'arrayBuffer', {
      configurable: true,
      value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    })
    installApi({
      uploadImage: vi.fn().mockRejectedValue(new Error(
        "Error invoking remote method 'harness-studio:workspace:upload-image': request pipe frame exceeds limit",
      )),
    })
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.paste(input, {
      clipboardData: {
        types: ['image/png'],
        getData: () => '',
        items: [{
          kind: 'file',
          type: 'image/png',
          getAsFile: () => image,
        }],
      },
    })

    expect(await screen.findByText('图片上传失败，请稍后重试。')).toBeTruthy()
    expect(screen.queryByText(/request pipe frame/u)).toBeNull()
  })

  it('uses Electron native clipboard capture for a macOS screenshot', async () => {
    const pasteImage = vi.fn().mockResolvedValue({
      attachment: { receiptId: 'native-image', name: 'pasted-image.png', bytes: 53_000 },
      mediaType: 'image/png',
      previewDataUrl: 'data:image/png;base64,cHJldmlldw==',
    })
    installApi({ pasteImage })
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.paste(input, {
      clipboardData: {
        types: ['image/tiff'],
        getData: () => '',
        items: [],
      },
    })

    await waitFor(() => expect(pasteImage).toHaveBeenCalledWith('project', session.id))
    const preview = await screen.findByRole('img', { name: 'pasted-image.png' })
    expect(preview.getAttribute('src')).toBe('data:image/png;base64,cHJldmlldw==')
  })

  it('keeps a selected workspace path out of free text and submits its Harness mention serialization', async () => {
    const files = vi.fn().mockResolvedValue([{ path: 'src/main.ts', kind: 'file' }])
    const { run } = installApi({ files })
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.change(input, { target: { value: '@main', selectionStart: 5 } })
    const candidate = await screen.findByRole('option', { name: /main\.ts/u })
    fireEvent.click(candidate)

    expect(screen.getByText('项目文件 · src/main.ts')).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe('')
    fireEvent.change(input, { target: { value: '检查入口', selectionStart: 4 } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(run).toHaveBeenCalledWith('project', session.id, {
      text: '检查入口',
      references: [{ path: 'src/main.ts', serializedText: '@src/main.ts' }],
      attachments: [],
    }))
  })

  it('hides commands that already have dedicated product controls', async () => {
    installApi()
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } })

    expect(await screen.findByRole('option', { name: /\/review/u })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /\/export/u })).toBeNull()
    expect(screen.queryByRole('option', { name: /\/feedback/u })).toBeNull()
    expect(screen.queryByRole('option', { name: /\/permission/u })).toBeNull()
  })

  it('turns skills and ordinary commands into structured invocation entities', async () => {
    const api = installApi()
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.change(input, { target: { value: '/agent', selectionStart: 6 } })
    fireEvent.click(await screen.findByRole('option', { name: /agent-browser/u }))
    expect(screen.getByText('Agent Browser')).toBeTruthy()
    expect(document.querySelector('.composer-invocation-token.skill')).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe('')

    fireEvent.change(input, { target: { value: '打开文档', selectionStart: 4 } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(api.run).toHaveBeenCalledWith('project', session.id, {
      text: '/agent-browser 打开文档',
      references: [],
      attachments: [],
    }))
    expect(api.command).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '/review', selectionStart: 7 } })
    fireEvent.click(await screen.findByRole('option', { name: /\/review/u }))
    fireEvent.change(input, { target: { value: '只看安全问题', selectionStart: 6 } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('project', session.id, {
      command: 'review',
      text: '只看安全问题',
      references: [],
      attachments: [],
    }))
  })

  it.each([
    ['goal', '目标', '描述你的目标', '完成发布准备'],
    ['plan', '计划', '描述你的任务以生成计划', '设计迁移方案'],
  ] as const)('presents /%s as a composer mode and submits it through the Harness command', async (name, label, placeholder, text) => {
    const api = installApi()
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.change(input, { target: { value: `/${name}`, selectionStart: name.length + 1 } })
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(`/${name}`) }))

    expect(screen.getByRole('button', { name: `退出${label}模式` })).toBeTruthy()
    expect(document.querySelector(`.composer-mode.${name}`)).toBeTruthy()
    expect((input as HTMLTextAreaElement).placeholder).toContain(placeholder)
    expect((input as HTMLTextAreaElement).value).toBe('')

    fireEvent.change(input, { target: { value: text, selectionStart: text.length } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('project', session.id, {
      command: name,
      text,
      references: [],
      attachments: [],
    }))
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.getByRole('button', { name: `退出${label}模式` })).toBeTruthy()
    expect((input as HTMLTextAreaElement).placeholder).toContain(placeholder)
  })

  it('keeps the goal text and explains how to replace an existing goal', async () => {
    const command = vi.fn().mockRejectedValue(new Error(
      '当前已有一个目标。请先点击“目标”退出，再创建新目标。',
    ))
    installApi({ command })
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.change(input, { target: { value: '/goal', selectionStart: 5 } })
    fireEvent.click(await screen.findByRole('option', { name: /\/goal/u }))
    fireEvent.change(input, { target: { value: '完成发布准备', selectionStart: 6 } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('当前已有一个目标。请先点击“目标”退出，再创建新目标。')).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe('完成发布准备')
    expect(screen.getByRole('button', { name: '退出目标模式' })).toBeTruthy()
  })

  it('opens fresh status data and runs context compaction from the slash menu', async () => {
    const status = {
      projectedTokens: 1200,
      contextWindow: 8000,
      systemTokens: 200,
      toolsTokens: 300,
      messageTokens: 700,
      usage: { uncachedInputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
      compactions: [],
    }
    const contextGet = vi.fn().mockResolvedValue(status)
    const api = installApi({ contextGet })
    render(<CodexApp />)

    const input = await screen.findByRole('textbox', { name: '描述编程任务' })
    fireEvent.change(input, { target: { value: '/status', selectionStart: 7 } })
    fireEvent.click(await screen.findByRole('option', { name: /\/status/u }))
    expect(await screen.findByRole('dialog', { name: '模型状态' })).toBeTruthy()
    await waitFor(() => expect(contextGet).toHaveBeenCalledWith(session.id))
    expect(screen.getByText(/1,200 \/ 8,000/u)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    fireEvent.change(input, { target: { value: '/compact', selectionStart: 8 } })
    fireEvent.click(await screen.findByRole('option', { name: /\/compact/u }))
    await waitFor(() => expect(api.compact).toHaveBeenCalledWith(session.id))
    expect((await screen.findByRole('status')).textContent).toContain('上下文压缩完成')
  })
})
