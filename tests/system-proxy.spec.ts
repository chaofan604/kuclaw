import { describe, expect, it, vi } from 'vitest'
import {
  proxyUrlFromRules,
  systemProxyEnvironment,
} from '../src/main/runtime/system-proxy.js'

describe('system proxy environment', () => {
  it('converts Chromium HTTP proxy rules to URL values', () => {
    expect(proxyUrlFromRules('PROXY 127.0.0.1:7897; DIRECT')).toBe('http://127.0.0.1:7897/')
    expect(proxyUrlFromRules('HTTPS proxy.example:8443; DIRECT')).toBe('https://proxy.example:8443/')
    expect(proxyUrlFromRules('SOCKS5 127.0.0.1:7898; DIRECT')).toBeUndefined()
    expect(proxyUrlFromRules('DIRECT; PROXY 127.0.0.1:7897')).toBeUndefined()
  })

  it('passes the system routes to both Host proxy spellings', async () => {
    const resolveProxy = vi.fn((url: string) => Promise.resolve(
      url.startsWith('https:') ? 'PROXY 127.0.0.1:7897; DIRECT' : 'PROXY 127.0.0.1:7896; DIRECT',
    ))

    await expect(systemProxyEnvironment(resolveProxy, {})).resolves.toEqual({
      http_proxy: 'http://127.0.0.1:7896/',
      HTTP_PROXY: 'http://127.0.0.1:7896/',
      https_proxy: 'http://127.0.0.1:7897/',
      HTTPS_PROXY: 'http://127.0.0.1:7897/',
    })
    expect(resolveProxy).toHaveBeenCalledTimes(2)
  })

  it('preserves an explicitly launched proxy policy', async () => {
    const resolveProxy = vi.fn(() => Promise.resolve('PROXY 127.0.0.1:7897'))

    await expect(systemProxyEnvironment(resolveProxy, { ALL_PROXY: 'socks5://127.0.0.1:1080' }))
      .resolves.toEqual({})
    expect(resolveProxy).not.toHaveBeenCalled()
  })

  it('keeps direct networking when system resolution fails', async () => {
    await expect(systemProxyEnvironment(
      () => Promise.reject(new Error('system proxy unavailable')),
      {},
    )).resolves.toEqual({})
  })
})
