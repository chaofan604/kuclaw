// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimpleModelSettings } from '../src/renderer/SimpleModelSettings.js'
import type { ModelConfiguration } from '../src/shared/contracts.js'

const configuration: ModelConfiguration = {
  available: true,
  writable: true,
  credentialConfigured: false,
  credentialWritable: true,
  baseURL: 'https://api.deepseek.com',
  maxTokens: 256_000,
  defaultSelection: { provider: 'custom-gateway', model: 'model-one' },
  groups: [],
  profiles: [{
    id: 'custom-gateway',
    displayName: 'OpenAI Responses 兼容接口',
    protocol: 'openai-responses',
    baseURL: 'https://models.example/v1',
    credentialConfigured: true,
    credentialWritable: true,
    models: [
      { id: 'model-one', name: 'model-one', contextWindow: 128_000, maxTokens: 32_768 },
      { id: 'model-two', name: 'model-two', contextWindow: 262_144, maxTokens: 32_768 },
    ],
  }],
  failures: [],
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SimpleModelSettings', () => {
  it('opens a blank independent form when adding a model', async () => {
    Object.defineProperty(window, 'harnessStudio', {
      configurable: true,
      value: {
        models: {
          getConfiguration: vi.fn().mockResolvedValue(configuration),
          updateConfiguration: vi.fn(),
          discover: vi.fn(),
          test: vi.fn(),
        },
      },
    })
    render(<SimpleModelSettings onClose={() => undefined} />)
    await screen.findByText('model-one')

    fireEvent.click(screen.getByRole('button', { name: /添加模型/u }))

    expect((screen.getByLabelText(/接口地址/u) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/model_name/u) as HTMLInputElement).value).toBe('')
    expect(screen.getByText('密钥写入 Harness 凭据存储。')).toBeTruthy()
    expect(screen.queryByText('联网工具')).toBeNull()
  })

  it('shows product-facing errors instead of Electron IPC details', async () => {
    Object.defineProperty(window, 'harnessStudio', {
      configurable: true,
      value: {
        models: {
          getConfiguration: vi.fn().mockResolvedValue(configuration),
          updateConfiguration: vi.fn(),
          discover: vi.fn(),
          test: vi.fn().mockRejectedValue(new Error(
            "Error invoking remote method 'harness-studio:models:test': Error: 模型接口已响应，但没有返回文本内容",
          )),
        },
      },
    })
    render(<SimpleModelSettings onClose={() => undefined} />)
    await screen.findByText('model-one')

    fireEvent.click(screen.getAllByRole('button', { name: '测试' })[0]!)

    await screen.findByText('模型接口已响应，但没有返回文本内容')
    expect(screen.queryByText(/invoking remote method/iu)).toBeNull()
    expect(screen.queryByText(/hello/iu)).toBeNull()
  })

  it('shows one card per model, tests a card, and opens its editor', async () => {
    const test = vi.fn().mockResolvedValue({ latencyMs: 42 })
    Object.defineProperty(window, 'harnessStudio', {
      configurable: true,
      value: {
        models: {
          getConfiguration: vi.fn().mockResolvedValue(configuration),
          updateConfiguration: vi.fn(),
          discover: vi.fn(),
          test,
        },
      },
    })
    render(<SimpleModelSettings onClose={() => undefined} />)

    await screen.findByText('model-one')
    expect(screen.getByText('model-two')).toBeTruthy()
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: '测试' })[0]!)
    await screen.findByText('连接正常')
    expect(screen.getByText('42ms')).toBeTruthy()
    expect(test).toHaveBeenCalledWith({ providerId: 'custom-gateway', modelId: 'model-one' })

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]!)
    await waitFor(() => expect(screen.getByRole('heading', { name: '编辑模型' })).toBeTruthy())
    expect((screen.getByDisplayValue('model-one') as HTMLInputElement).value).toBe('model-one')
  })
})
