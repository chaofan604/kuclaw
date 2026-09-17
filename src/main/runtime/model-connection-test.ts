import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseDotenv } from 'dotenv'
import { parseDocument } from 'yaml'
import type {
  ModelProviderProtocol,
  ModelTestResult,
} from '../../shared/contracts.js'

const TEST_TIMEOUT_MS = 30_000
const MAX_ERROR_LENGTH = 400

interface ModelConnectionSpec {
  protocol: ModelProviderProtocol
  baseURL: string
  model: string
  apiKey: string
}

interface CredentialResolverOptions {
  homeDir: string
  projectDir: string
  environment?: NodeJS.ProcessEnv
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function endpoint(baseURL: string, suffix: string): string {
  return `${baseURL.trim().replace(/\/+$/u, '')}/${suffix}`
}

function textBlocks(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((block) => {
    if (!isRecord(block)) return []
    if (typeof block.text === 'string') return [block.text]
    return []
  }).join('')
}

function responseText(protocol: ModelProviderProtocol, value: unknown): string {
  if (!isRecord(value)) return ''
  if (protocol === 'anthropic-messages') return textBlocks(value.content)
  if (protocol === 'openai-responses') {
    if (typeof value.output_text === 'string') return value.output_text
    if (!Array.isArray(value.output)) return ''
    return value.output.flatMap((item) => isRecord(item) ? [textBlocks(item.content)] : []).join('')
  }
  if (!Array.isArray(value.choices)) return ''
  const first = value.choices[0]
  if (!isRecord(first) || !isRecord(first.message)) return ''
  return typeof first.message.content === 'string'
    ? first.message.content
    : textBlocks(first.message.content)
}

function requestFor(spec: ModelConnectionSpec): { url: string; headers: HeadersInit; body: string } {
  if (spec.protocol === 'anthropic-messages') {
    return {
      url: endpoint(spec.baseURL, 'messages'),
      headers: {
        'content-type': 'application/json',
        ...(spec.apiKey === '' ? {} : { 'x-api-key': spec.apiKey }),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: spec.model,
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 256,
      }),
    }
  }
  if (spec.protocol === 'openai-responses') {
    return {
      url: endpoint(spec.baseURL, 'responses'),
      headers: {
        ...(spec.apiKey === '' ? {} : { authorization: `Bearer ${spec.apiKey}` }),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: spec.model, input: 'hello', max_output_tokens: 256 }),
    }
  }
  return {
    url: endpoint(spec.baseURL, 'chat/completions'),
    headers: {
      authorization: `Bearer ${spec.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: spec.model,
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 256,
    }),
  }
}

function safeProviderMessage(value: unknown, apiKey: string): string {
  if (!isRecord(value)) return ''
  const error = isRecord(value.error) ? value.error : value
  const message = typeof error.message === 'string' ? error.message : ''
  return (apiKey === '' ? message : message.replaceAll(apiKey, '[REDACTED]')).slice(0, MAX_ERROR_LENGTH)
}

/** Send a minimal hello request through one configured model protocol. */
export async function testModelConnection(
  spec: ModelConnectionSpec,
  fetchImplementation: typeof fetch = fetch,
): Promise<ModelTestResult> {
  const request = requestFor(spec)
  const startedAt = performance.now()
  const response = await fetchImplementation(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    redirect: 'error',
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(response.ok
      ? '模型接口返回了无法解析的响应'
      : `模型接口返回 HTTP ${String(response.status)}`)
  }
  if (!response.ok) {
    const detail = safeProviderMessage(payload, spec.apiKey)
    throw new Error(`模型接口返回 HTTP ${String(response.status)}${detail === '' ? '' : `：${detail}`}`)
  }
  const reply = responseText(spec.protocol, payload).trim()
  if (reply === '') throw new Error('模型接口已响应，但没有返回文本内容')
  return {
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function credentialFromYaml(source: string, ref: string): string | undefined {
  const document = parseDocument(source, { prettyErrors: false })
  if (document.errors.length > 0) throw new Error('Harness 凭据文件格式无效')
  const value = document.toJS() as unknown
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.refs)) {
    throw new Error('Harness 凭据文件格式无效')
  }
  const credential = value.refs[ref]
  return typeof credential === 'string' && credential !== '' ? credential : undefined
}

/** Resolve a Harness credential with the same source precedence used by the Host. */
export class HarnessCredentialResolver {
  private readonly environment: NodeJS.ProcessEnv

  constructor(private readonly options: CredentialResolverOptions) {
    this.environment = options.environment ?? process.env
  }

  async resolve(ref: string): Promise<string | undefined> {
    const inherited = this.environment[ref]
    if (inherited !== undefined && inherited !== '') return inherited
    const managed = await readOptional(join(this.options.homeDir, '.credentials.yaml'))
    if (managed !== undefined) {
      const credential = credentialFromYaml(managed, ref)
      if (credential !== undefined) return credential
    }
    for (const path of [join(this.options.projectDir, '.env'), join(this.options.homeDir, '.env')]) {
      const source = await readOptional(path)
      if (source === undefined) continue
      const credential = parseDotenv(source)[ref]
      if (credential !== undefined && credential !== '') return credential
    }
    return undefined
  }
}
