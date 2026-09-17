import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  HarnessCredentialResolver,
  testModelConnection,
} from '../src/main/runtime/model-connection-test.js'
import type { ModelProviderProtocol } from '../src/shared/contracts.js'

const cases: Array<{
  protocol: ModelProviderProtocol
  path: string
  headers: Record<string, string>
  body: Record<string, unknown>
  response: Record<string, unknown>
}> = [
  {
    protocol: 'openai-completions',
    path: '/v1/chat/completions',
    headers: { authorization: 'Bearer secret' },
    body: { model: 'test-model', messages: [{ role: 'user', content: 'hello' }], max_tokens: 256 },
    response: { choices: [{ message: { content: 'chat hello' } }] },
  },
  {
    protocol: 'openai-responses',
    path: '/v1/responses',
    headers: { authorization: 'Bearer secret' },
    body: { model: 'test-model', input: 'hello', max_output_tokens: 256 },
    response: { output: [{ content: [{ type: 'output_text', text: 'response hello' }] }] },
  },
  {
    protocol: 'anthropic-messages',
    path: '/v1/messages',
    headers: { 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' },
    body: { model: 'test-model', messages: [{ role: 'user', content: 'hello' }], max_tokens: 256 },
    response: { content: [{ type: 'text', text: 'anthropic hello' }] },
  },
]

describe('model connection test', () => {
  for (const testCase of cases) {
    it(`sends and parses ${testCase.protocol}`, async () => {
      const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
        expect(new URL(String(input)).pathname).toBe(testCase.path)
        expect(init?.method).toBe('POST')
        expect(init?.redirect).toBe('error')
        const headers = new Headers(init?.headers)
        for (const [name, value] of Object.entries(testCase.headers)) expect(headers.get(name)).toBe(value)
        expect(JSON.parse(String(init?.body))).toEqual(testCase.body)
        return Response.json(testCase.response)
      })

      const result = await testModelConnection({
        protocol: testCase.protocol,
        baseURL: 'https://models.example/v1/',
        model: 'test-model',
        apiKey: 'secret',
      }, fetchImplementation)

      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      expect(fetchImplementation).toHaveBeenCalledOnce()
    })
  }

  it('redacts the credential from provider errors', async () => {
    const request = testModelConnection({
      protocol: 'openai-responses',
      baseURL: 'https://models.example/v1',
      model: 'test-model',
      apiKey: 'secret-value',
    }, () => Promise.resolve(Response.json({ error: { message: 'bad secret-value' } }, { status: 401 })))

    await expect(request).rejects.toThrow('bad [REDACTED]')
  })
})

describe('HarnessCredentialResolver', () => {
  it('resolves environment, managed file, project env, and user env in order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-model-credential-'))
    const homeDir = join(root, 'home')
    const projectDir = join(root, 'project')
    await Promise.all([mkdir(homeDir), mkdir(projectDir)])
    const credentialsPath = join(homeDir, '.credentials.yaml')
    await writeFile(credentialsPath, 'version: 1\nrefs:\n  MANAGED: managed-value\n  SHADOWED: managed-shadow\n')
    await chmod(credentialsPath, 0o600)
    await writeFile(join(projectDir, '.env'), 'PROJECT=project-value\nSHADOWED=project-shadow\n')
    await writeFile(join(homeDir, '.env'), 'USER=user-value\nPROJECT=user-shadow\n')
    const resolver = new HarnessCredentialResolver({
      homeDir,
      projectDir,
      environment: { INHERITED: 'inherited-value', SHADOWED: 'environment-shadow' },
    })

    await expect(resolver.resolve('INHERITED')).resolves.toBe('inherited-value')
    await expect(resolver.resolve('MANAGED')).resolves.toBe('managed-value')
    await expect(resolver.resolve('PROJECT')).resolves.toBe('project-value')
    await expect(resolver.resolve('USER')).resolves.toBe('user-value')
    await expect(resolver.resolve('SHADOWED')).resolves.toBe('environment-shadow')
  })
})
