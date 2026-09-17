import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import type {
  ApprovalDecision,
  BackgroundTask,
  CompactionRecord,
  ContextStatus,
  ContextCompactResult,
  ChatFileAttachment,
  ChatMessage,
  ChatReasoning,
  DiffLine,
  ModelCatalogModel,
  ModelConfiguration,
  ModelConfigurationUpdate,
  ModelDiscoveryRequest,
  ModelDiscoveryResult,
  ModelProviderGroup,
  ModelProviderProfile,
  ModelProviderProfileInput,
  ModelProviderProtocol,
  ModelSelection,
  ModelTestRequest,
  ModelTestResult,
  PendingInteraction,
  PermissionSelection,
  QuestionAnswer,
  QuestionItem,
  RunReceipt,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskUpdate,
  RuntimeEvent,
  RuntimeHostStatus,
  SessionRecord,
  SessionScope,
  SessionSummary,
  SkillEntry,
  FileCandidate,
  CommandSummary,
  ComposerCommandSubmission,
  ComposerFileAttachment,
  ComposerImageUpload,
  ComposerSubmission,
  ToolCard,
} from '../../shared/contracts.js'
import { HarnessHostClient, HarnessRemoteError } from './dsh-host-client.js'
import type { HarnessHostProcess } from './dsh-host-process.js'
import type { AgentRuntime } from './runtime.js'
import { testModelConnection } from './model-connection-test.js'
import {
  inferInputModalities,
  inferReasoningProfile,
  type ModelInputModality,
  type ReasoningEffortMap,
} from './model-reasoning.js'
import { MODEL_STREAM_IDLE_TIMEOUT_MS, PERMISSION_PROJECTION_TIMEOUT_MS } from './harness-policy.js'
import type { LocalSkillLibrary } from './skill-library.js'

interface HarnessSessionSummary {
  readonly sessionId: string
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly cwd?: string
  readonly projections?: {
    readonly values?: Record<string, unknown>
  }
}

interface HarnessSessionList {
  readonly items: readonly HarnessSessionSummary[]
}

interface HarnessWorkspaceFollowFrame {
  readonly type: string
  readonly value?: {
    readonly archivedSessionIds?: readonly string[]
  }
}

interface HarnessWorkspaceArchiveValue {
  readonly archivedSessionIds: readonly string[]
}

interface HarnessModelCatalog {
  readonly default: ModelSelection
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly {
      readonly id: string
      readonly name: string
      readonly description?: string
      readonly reasoning?: {
        readonly efforts: readonly {
          readonly id: string
          readonly name: string
          readonly description?: string
        }[]
        readonly defaultEffort?: string
      }
    }[]
  }[]
  readonly failures: readonly {
    readonly id: string
    readonly name: string
    readonly message: string
  }[]
}

interface HarnessSettingsNamespace {
  readonly ns: string
  readonly value: unknown
  readonly revision: number
}

interface HarnessSettingsDescription {
  readonly writable: boolean
  readonly namespaces: readonly HarnessSettingsNamespace[]
}

interface HarnessCredentialInfo {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

interface HarnessPiProviderProfile {
  readonly apiKeyEnv?: string
  readonly displayName?: string
  readonly api?: string
  readonly baseURL?: string
  readonly reasoning?: string
  readonly streamIdleTimeoutMs?: number
  readonly models?: readonly {
    readonly id?: string
    readonly name?: string
    readonly contextWindow?: number
    readonly maxTokens?: number
    readonly input?: readonly ModelInputModality[]
    readonly reasoningEfforts?: false | ReasoningEffortMap
  }[]
}

interface HarnessDiscoveredModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

interface HarnessWireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly surfaceOp?: unknown
}

interface HarnessFollowSnapshot {
  readonly type: 'snapshot'
  readonly header: {
    readonly id: string
    readonly createdAt: number
    readonly cwd?: string
  }
  readonly cursor: number
  readonly records: readonly {
    readonly type: 'event'
    readonly event: HarnessWireEvent
  }[]
  readonly projections: {
    readonly values?: Record<string, unknown>
  }
  readonly assistantStream?: {
    readonly activeAttempt?: {
      readonly attemptId: string
      readonly stream: readonly unknown[]
    }
  }
}

type HarnessAssistantFrame =
  | {
    readonly type: 'start'
    readonly attemptId: string
  }
  | {
    readonly type: 'chunk'
    readonly attemptId: string
    readonly time: number
    readonly chunk: unknown
  }
  | {
    readonly type: 'end'
    readonly attemptId: string
    readonly outcome: { readonly kind: 'committed' | 'abandoned' }
  }

type HarnessFollowFrame =
  | HarnessFollowSnapshot
  | {
    readonly type: 'event'
    readonly event: HarnessWireEvent
  }
  | {
    readonly type: 'assistant-stream'
    readonly frame: HarnessAssistantFrame
  }
  | {
    readonly type: 'projection'
    readonly sessionId: string
    readonly key: string
    readonly value: unknown
    readonly seq: number
  }

interface LiveAssistant {
  attemptId: string
  text: string
  reasoning: string
  createdAt: number
  state: ChatMessage['state']
  presentation: NonNullable<ChatMessage['presentation']>
}

interface HarnessSessionState {
  id: string
  cwd: string
  createdAt: number
  updatedAt: number
  title: string
  running: boolean
  error: boolean
  modelSelection?: ModelSelection
  permissionSelection?: PermissionSelection
  projections: Record<string, unknown>
  jobs: BackgroundTask[]
  events: HarnessWireEvent[]
  liveAssistant?: LiveAssistant
}

interface PendingRemoteInteraction {
  interaction: PendingInteraction
  clientId: string
  eventId: string
}

interface RemoteEventFrame {
  readonly type: string
  readonly clientId?: unknown
  readonly eventId?: unknown
  readonly event?: unknown
  readonly agentId?: unknown
  readonly request?: unknown
}

type HarnessControlFrame =
  | {
    readonly type: 'baseline'
    readonly value: {
      readonly jobs?: Record<string, readonly BackgroundTask[]>
      readonly projections?: Record<string, { readonly values?: Record<string, unknown> }>
    }
  }
  | { readonly type: 'jobs'; readonly sessionId: string; readonly jobs: readonly BackgroundTask[] }
  | { readonly type: 'projection'; readonly sessionId: string; readonly key: string; readonly value: unknown; readonly seq: number }
  | { readonly type: 'queue'; readonly sessionId: string; readonly items: readonly unknown[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((block) => {
    if (!isRecord(block)) return []
    if (block.type === 'text' && typeof block.text === 'string') return [block.text]
    if (Array.isArray(block.content)) {
      const nested = contentText(block.content)
      return nested === '' ? [] : [nested]
    }
    return []
  }).join('')
}

function containsToolCall(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsToolCall)
  if (!isRecord(value)) return false
  if (value.type === 'tool-call' || value.type === 'tool-call-chunks' || value.blockType === 'tool-call') return true
  return Object.values(value).some(containsToolCall)
}

function contentFiles(value: unknown): ChatFileAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((block): ChatFileAttachment[] => {
    if (!isRecord(block)) return []
    if (block.type === 'file' && isRecord(block.attachment)) {
      const attachment = block.attachment
      if (typeof attachment.attachmentId !== 'string'
        || attachment.attachmentId === ''
        || typeof attachment.name !== 'string'
        || typeof attachment.bytes !== 'number'
        || !Number.isSafeInteger(attachment.bytes)
        || attachment.bytes < 0) return []
      return [{
        id: attachment.attachmentId,
        name: attachment.name === '' ? '未命名文件' : attachment.name,
        bytes: attachment.bytes,
      }]
    }
    return Array.isArray(block.content) ? contentFiles(block.content) : []
  })
}

function resultFailed(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some(block => isRecord(block)
    && (block.isError === true || resultFailed(block.content)))
}

function titleOf(summary: HarnessSessionSummary, scope: SessionScope): string {
  const title = summary.projections?.values?.title
  if (typeof title === 'string' && title !== '') return title
  if (scope === 'daily') return '新对话'
  if (summary.cwd !== undefined) return `新任务 · ${basename(summary.cwd)}`
  return summary.sessionId
}

function sourceRequestId(data: Record<string, unknown>): string | undefined {
  const source = data.source
  return isRecord(source) && typeof source.rpcId === 'string' ? source.rpcId : undefined
}

function permissionSelectionOf(value: unknown): PermissionSelection | undefined {
  if (!isRecord(value) || !Array.isArray(value.options) || typeof value.currentValue !== 'string') return undefined
  const options = value.options.flatMap(option => {
    if (!isRecord(option) || typeof option.value !== 'string' || typeof option.name !== 'string') return []
    return [{
      value: option.value,
      name: option.name,
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
    }]
  })
  if (options.length !== value.options.length) return undefined
  return { options, currentValue: value.currentValue }
}

function goalStatusOf(value: unknown): SessionRecord['goalStatus'] {
  if (!isRecord(value) || !isRecord(value.goal)) return undefined
  const phase = value.goal.phase
  if (typeof value.goal.objective !== 'string'
    || !['active', 'paused', 'blocked', 'complete'].includes(String(phase))
    || typeof value.roundsStarted !== 'number'
    || !Number.isSafeInteger(value.roundsStarted)
    || value.roundsStarted < 0) return undefined
  return {
    objective: value.goal.objective,
    phase: phase as NonNullable<SessionRecord['goalStatus']>['phase'],
    roundsStarted: value.roundsStarted,
  }
}

function planStatusOf(value: unknown): SessionRecord['planStatus'] {
  if (!isRecord(value) || typeof value.active !== 'boolean' || typeof value.pending !== 'boolean') return undefined
  return { active: value.active, pending: value.pending }
}

function messageOf(event: HarnessWireEvent): ChatMessage | undefined {
  if (!isRecord(event.data)) return undefined
  if (event.type === 'command/run') {
    const source = event.data.source
    if (event.data.name !== 'goal'
      || typeof event.data.commandId !== 'string'
      || !isRecord(source)
      || source.kind !== 'user') return undefined
    const args = typeof event.data.args === 'string' ? event.data.args.trim() : ''
    return {
      id: event.data.commandId,
      role: 'user',
      text: args,
      createdAt: event.time,
      state: 'complete',
      sequence: event.seq,
      invocation: {
        kind: 'goal',
        name: 'goal',
        label: '目标',
      },
    }
  }
  if (event.type === 'user/message') {
    const text = contentText(event.data.content)
    const attachments = contentFiles(event.data.content)
    if (text === '' && attachments.length === 0) return undefined
    const source = event.data.source
    if (isRecord(source) && source.kind !== 'user') return undefined
    return {
      id: typeof event.data.id === 'string'
        ? event.data.id
        : sourceRequestId(event.data) ?? `user-${String(event.seq)}`,
      role: 'user',
      text,
      createdAt: event.time,
      state: 'complete',
      sequence: event.seq,
      ...(attachments.length === 0 ? {} : { attachments }),
    }
  }
  if (event.type !== 'assistant/message') return undefined
  const message = event.data.message
  if (!isRecord(message)) return undefined
  const text = contentText(message.content)
  if (text === '') return undefined
  return {
    id: typeof message.id === 'string' ? message.id : `assistant-${String(event.seq)}`,
    role: 'assistant',
    text,
    createdAt: event.time,
    state: 'complete',
    sequence: event.seq,
    presentation: containsToolCall(message.content) ? 'activity' : 'answer',
  }
}

function turnFailureMessage(reason: unknown): string | undefined {
  if (!isRecord(reason) || reason.kind !== 'error' || !isRecord(reason.error)) return undefined
  const code = reason.error.code
  if (code === 'TIMEOUT') return '模型响应超时，请检查网络连接后重试。'
  if (code === 'MISSING_CREDENTIAL' || code === 'AUTHENTICATION') {
    return '模型认证失败，请前往设置检查 API Key 后重试。'
  }
  if (code === 'RATE_LIMIT') return '模型服务当前请求较多，请稍后重试。'
  if (code === 'CONTEXT_LENGTH' || code === 'INPUT_TOO_LARGE') {
    return '当前对话内容过长，请精简内容或新建对话后重试。'
  }
  return '模型暂时无法完成回答，请稍后重试。'
}

export function projectMessages(events: readonly HarnessWireEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  const answeredTurns = new Set<number>()
  let pendingPlanText: string | undefined
  for (const event of events) {
    if (event.type === 'command/run' && isRecord(event.data) && event.data.name === 'plan'
      && isRecord(event.data.source) && event.data.source.kind === 'user') {
      pendingPlanText = typeof event.data.args === 'string' ? event.data.args.trim() : ''
    }
    const message = messageOf(event)
    if (message !== undefined) {
      if (message.role === 'user' && pendingPlanText !== undefined && message.text.trim() === pendingPlanText) {
        message.invocation = { kind: 'plan', name: 'plan', label: '计划' }
        pendingPlanText = undefined
      }
      messages.push(message)
      if (event.type === 'assistant/message' && message.presentation === 'answer'
        && isRecord(event.data) && typeof event.data.turn === 'number') answeredTurns.add(event.data.turn)
      continue
    }
    if (event.type !== 'turn/end' || !isRecord(event.data) || typeof event.data.turn !== 'number'
      || answeredTurns.has(event.data.turn)) continue
    const text = turnFailureMessage(event.data.reason)
    if (text === undefined) continue
    messages.push({
      id: `turn-error-${String(event.data.turn)}-${String(event.seq)}`,
      role: 'assistant',
      text,
      createdAt: event.time,
      state: 'error',
      sequence: event.seq,
      presentation: 'answer',
    })
  }
  return messages
}

/** Extract complete reasoning text and its first timestamp from an embedded Assistant stream. */
function embeddedReasoning(stream: unknown, fallbackTime: number): { text: string; createdAt: number } | undefined {
  if (!Array.isArray(stream)) return undefined
  const parts: string[] = []
  let createdAt = fallbackTime
  let foundTime = false
  for (const member of stream) {
    if (!isRecord(member)) continue
    if (member.type === 'reasoning-delta' && typeof member.text === 'string') {
      if (member.text !== '') parts.push(member.text)
      continue
    }
    if (member.type === 'reasoning-chunks' && Array.isArray(member.texts)) {
      const text = member.texts.filter((value): value is string => typeof value === 'string').join('')
      if (text === '') continue
      parts.push(text)
      if (!foundTime && typeof member.time0 === 'number') {
        createdAt = member.time0
        foundTime = true
      }
      continue
    }
    if (member.type !== 'chunk' || !isRecord(member.chunk)) continue
    const chunk = member.chunk
    const text = chunk.type === 'reasoning-delta' && typeof chunk.text === 'string'
      ? chunk.text
      : chunk.type === 'block-end' && isRecord(chunk.block) && chunk.block.type === 'reasoning'
        && typeof chunk.block.text === 'string' && parts.length === 0
        ? chunk.block.text
        : ''
    if (text === '') continue
    parts.push(text)
    if (!foundTime && typeof member.time === 'number') {
      createdAt = member.time
      foundTime = true
    }
  }
  return parts.length === 0 ? undefined : { text: parts.join(''), createdAt }
}

function embeddedText(stream: readonly unknown[]): string {
  return stream.flatMap((member): string[] => {
    if (!isRecord(member)) return []
    if (member.type === 'text-delta' && typeof member.text === 'string') return [member.text]
    if (member.type === 'text-chunks' && Array.isArray(member.texts)) {
      return member.texts.filter((value): value is string => typeof value === 'string')
    }
    if (member.type === 'chunk') {
      const text = textDelta(member.chunk)
      return text === '' ? [] : [text]
    }
    return []
  }).join('')
}

/** Project streamed reasoning into passages that retain each model step's position. */
export function projectReasoning(events: readonly HarnessWireEvent[]): ChatReasoning[] {
  const passages: ChatReasoning[] = []
  const settledCoordinates = new Set<string>()
  for (const event of events) {
    if ((event.type !== 'assistant/attempt' && event.type !== 'assistant/message') || !isRecord(event.data)) continue
    const turn = typeof event.data.turn === 'number' ? event.data.turn : 0
    const step = typeof event.data.step === 'number' ? event.data.step : event.seq
    settledCoordinates.add(`${String(turn)}:${String(step)}`)
    let projected = embeddedReasoning(event.data.stream, event.time)
    if (projected === undefined && event.type === 'assistant/message' && isRecord(event.data.message)
      && Array.isArray(event.data.message.content)) {
      const text = event.data.message.content.flatMap((block) => isRecord(block)
        && block.type === 'reasoning' && typeof block.text === 'string' ? [block.text] : []).join('\n')
      if (text !== '') projected = { text, createdAt: event.time }
    }
    if (projected !== undefined) {
      passages.push({
        id: `reasoning-${String(turn)}-${String(step)}-${String(event.seq)}`,
        text: projected.text,
        createdAt: projected.createdAt,
        state: 'complete',
        sequence: event.seq,
      })
    }
  }

  const legacy = new Map<string, ChatReasoning>()
  for (const event of events) {
    if (event.type !== 'assistant/chunk' || !isRecord(event.data) || !isRecord(event.data.chunk)) continue
    const chunk = event.data.chunk
    if (chunk.type !== 'reasoning-delta' || typeof chunk.text !== 'string' || chunk.text === '') continue
    const turn = typeof event.data.turn === 'number' ? event.data.turn : 0
    const step = typeof event.data.step === 'number' ? event.data.step : event.seq
    if (settledCoordinates.has(`${String(turn)}:${String(step)}`)) continue
    const index = typeof chunk.index === 'number' ? chunk.index : 0
    const id = `reasoning-${String(turn)}-${String(step)}-${String(index)}`
    const existing = legacy.get(id)
    if (existing === undefined) legacy.set(id, { id, text: chunk.text, createdAt: event.time, state: 'complete', sequence: event.seq })
    else existing.text += chunk.text
  }
  return [...passages, ...legacy.values()].sort((left, right) => left.createdAt - right.createdAt)
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function toolKind(name: string): ToolCard['kind'] {
  if (/bash|shell|terminal|command/u.test(name)) return 'terminal'
  if (/write|edit|patch|replace/u.test(name)) return 'diff'
  if (/search|grep|glob|find/u.test(name)) return 'search'
  if (/web|fetch|browser/u.test(name)) return 'web'
  if (/read|file|image/u.test(name)) return 'read'
  return 'other'
}

function toolDetail(name: string, args: Record<string, unknown>): string {
  if (name === 'web_search' && Array.isArray(args.queries)) {
    return args.queries.filter((query): query is string => typeof query === 'string').join(' · ')
  }
  return ''
}

function linesOf(text: string, kind: DiffLine['kind']): DiffLine[] {
  if (text === '') return []
  return text.split('\n').map(line => ({ kind, text: line }))
}

function applyPresentation(card: ToolCard, meta: unknown): void {
  if (!isRecord(meta)) return
  if (Array.isArray(meta.diffs)) {
    const diffs = meta.diffs.flatMap((candidate): DiffLine[] => {
      if (!isRecord(candidate)) return []
      if (typeof candidate.path === 'string') card.path = candidate.path
      const before = typeof candidate.oldText === 'string' ? candidate.oldText : ''
      const after = typeof candidate.newText === 'string' ? candidate.newText : ''
      return [...linesOf(before, 'removed'), ...linesOf(after, 'added')]
    })
    if (diffs.length > 0) {
      card.kind = 'diff'
      card.diff = diffs
    }
  }
  if (typeof meta.viewport === 'string') {
    card.kind = 'terminal'
    card.output = meta.viewport
  }
  if (isRecord(meta.sessionStatus)) {
    if (typeof meta.sessionStatus.exitCode === 'number') card.exitCode = meta.sessionStatus.exitCode
    if (typeof meta.sessionStatus.signal === 'string') card.signal = meta.sessionStatus.signal
  }
  if (typeof meta.path === 'string') {
    card.kind = 'read'
    card.path = meta.path
  }
  if (Array.isArray(meta.files) || Array.isArray(meta.paths)) {
    card.kind = 'search'
    if (typeof meta.total === 'number') card.total = meta.total
  }
  if (Array.isArray(meta.sources)) {
    card.kind = card.title === 'web_search' ? 'search' : 'web'
    card.total = meta.sources.length
  }
  if (typeof meta.url === 'string') {
    card.kind = 'web'
    card.url = meta.url
  }
  if (typeof meta.statusCode === 'number') card.statusCode = meta.statusCode
  if (typeof meta.truncated === 'boolean') card.truncated = meta.truncated
}

export function projectToolCards(events: readonly HarnessWireEvent[]): ToolCard[] {
  const cards = new Map<string, ToolCard>()
  for (const event of events) {
    if (!isRecord(event.data)) continue
    if (event.type === 'tool/call') {
      const callId = event.data.callId
      const name = event.data.name
      if (typeof callId !== 'string' || typeof name !== 'string') continue
      const args = parseArguments(event.data.arguments)
      cards.set(callId, {
        id: callId,
        title: name,
        kind: toolKind(name),
        state: 'pending',
        detail: toolDetail(name, args),
        createdAt: event.time,
        sequence: event.seq,
        ...(typeof args.path === 'string'
          ? { path: args.path }
          : typeof args.file_path === 'string'
            ? { path: args.file_path }
            : typeof args.url === 'string'
              ? { url: args.url }
              : {}),
      })
      continue
    }
    if (event.type !== 'tool/result') continue
    const message = event.data.message
    if (!isRecord(message) || !isRecord(message.source) || typeof message.source.callId !== 'string') continue
    const card = cards.get(message.source.callId)
    if (card === undefined) continue
    card.state = resultFailed(message.content) || isRecord(event.data.error) ? 'error' : 'complete'
    const output = contentText(message.content)
    if (output !== '') card.output = output
    applyPresentation(card, event.data.meta)
  }
  return [...cards.values()]
}

function textDelta(chunk: unknown): string {
  return isRecord(chunk) && chunk.type === 'text-delta' && typeof chunk.text === 'string'
    ? chunk.text
    : ''
}

function reasoningDelta(chunk: unknown): string {
  return isRecord(chunk) && chunk.type === 'reasoning-delta' && typeof chunk.text === 'string'
    ? chunk.text
    : ''
}

function modelGroups(catalog: HarnessModelCatalog): ModelProviderGroup[] {
  return catalog.groups.map(group => ({
    id: group.id,
    name: group.name,
    models: group.models.map((model): ModelCatalogModel => ({
      id: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      reasoningEfforts: model.reasoning?.efforts.map(effort => ({
        id: effort.id,
        name: effort.name,
        ...(effort.description === undefined ? {} : { description: effort.description }),
      })) ?? [],
      ...(model.reasoning?.defaultEffort === undefined
        ? {}
        : { defaultReasoningEffort: model.reasoning.defaultEffort }),
    })),
  }))
}

function namespaceValue(
  description: HarnessSettingsDescription,
  namespace: string,
): { value: Record<string, unknown>; revision: number } {
  const entry = description.namespaces.find(candidate => candidate.ns === namespace)
  return {
    value: isRecord(entry?.value) ? entry.value : {},
    revision: entry?.revision ?? 0,
  }
}

const MODEL_PROTOCOLS: readonly ModelProviderProtocol[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
]

function isModelProtocol(value: unknown): value is ModelProviderProtocol {
  return typeof value === 'string' && MODEL_PROTOCOLS.includes(value as ModelProviderProtocol)
}

function credentialRefForProfile(profileId: string): string {
  const digest = createHash('sha256').update(profileId).digest('hex').slice(0, 20).toUpperCase()
  return `HARNESS_STUDIO_MODEL_${digest}_API_KEY`
}

function sameReasoningEfforts(
  left: false | ReasoningEffortMap | undefined,
  right: ReasoningEffortMap,
): boolean {
  if (left === false || left === undefined) return false
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return leftEntries.length === rightEntries.length
    && rightEntries.every(([key, value]) => left[key] === value)
}

function sameInputModalities(
  left: readonly ModelInputModality[] | undefined,
  right: readonly ModelInputModality[],
): boolean {
  return left !== undefined
    && left.length === right.length
    && right.every((value, index) => left[index] === value)
}

function rawProfiles(settings: HarnessSettingsDescription): Record<string, HarnessPiProviderProfile> {
  const providers = namespaceValue(settings, 'llm-pi-ai').value.providers
  if (!isRecord(providers)) return {}
  const result: Record<string, HarnessPiProviderProfile> = {}
  for (const [id, value] of Object.entries(providers)) {
    if (isRecord(value)) result[id] = value
  }
  return result
}

function configuredProfiles(
  settings: HarnessSettingsDescription,
  credentials: Record<string, HarnessCredentialInfo>,
): ModelProviderProfile[] {
  return Object.entries(rawProfiles(settings)).flatMap(([id, raw]) => {
    if (!isModelProtocol(raw.api) || typeof raw.baseURL !== 'string') return []
    const ref = typeof raw.apiKeyEnv === 'string' ? raw.apiKeyEnv : credentialRefForProfile(id)
    const credential = credentials[ref]
    const models = Array.isArray(raw.models)
      ? raw.models.flatMap((model) => {
        if (!isRecord(model) || typeof model.id !== 'string' || model.id === '') return []
        return [{
          id: model.id,
          name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
          contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : 262_144,
          maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : 32_768,
        }]
      })
      : []
    return [{
      id,
      displayName: typeof raw.displayName === 'string' && raw.displayName !== '' ? raw.displayName : id,
      protocol: raw.api,
      baseURL: raw.baseURL,
      credentialConfigured: credential?.configured ?? false,
      ...(credential?.source === undefined ? {} : { credentialSource: credential.source }),
      credentialWritable: credential?.writable ?? false,
      models,
    }]
  })
}

function validateModelUpdate(update: ModelConfigurationUpdate): void {
  if (update.apiKey !== undefined && update.apiKey.trim() === '') {
    throw new Error('API Key 不能为空；如需删除，请使用清除操作')
  }
  if (update.baseURL !== undefined) {
    let url: URL
    try {
      url = new URL(update.baseURL)
    } catch {
      throw new Error('模型服务地址不是有效 URL')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('模型服务地址仅支持 http 或 https')
    }
  }
  if (update.maxTokens !== undefined
    && (!Number.isSafeInteger(update.maxTokens) || update.maxTokens <= 0)) {
    throw new Error('最大输出 Token 必须是正整数')
  }
  if (update.defaultSelection !== undefined
    && (update.defaultSelection.provider.trim() === '' || update.defaultSelection.model.trim() === '')) {
    throw new Error('默认模型必须包含提供方和模型 ID')
  }
  if (update.upsertProfile !== undefined) validateProviderProfile(update.upsertProfile)
  if (update.removeProfileId !== undefined
    && !/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(update.removeProfileId)) {
    throw new Error('要删除的接口 ID 不合法')
  }
  if (update.upsertProfile !== undefined && update.removeProfileId !== undefined) {
    throw new Error('同一次保存不能同时新增和删除模型接口')
  }
}

function validateProviderProfile(profile: ModelProviderProfileInput): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(profile.id)) {
    throw new Error('接口 ID 只能包含小写字母、数字、短横线和下划线，最长 32 个字符')
  }
  if (profile.displayName.trim() === '') throw new Error('接口名称不能为空')
  if (!MODEL_PROTOCOLS.includes(profile.protocol)) throw new Error('不支持的模型接口协议')
  let url: URL
  try {
    url = new URL(profile.baseURL)
  } catch {
    throw new Error('模型接口地址不是有效 URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('模型接口地址仅支持 http 或 https')
  }
  if (profile.models.length === 0) throw new Error('模型接口至少需要一个模型')
  const ids = new Set<string>()
  for (const model of profile.models) {
    if (model.id.trim() === '') throw new Error('模型 ID 不能为空')
    if (ids.has(model.id)) throw new Error(`模型 ID "${model.id}" 重复`)
    ids.add(model.id)
    if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) {
      throw new Error(`模型 "${model.id}" 的上下文窗口必须是正整数`)
    }
    if (!Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0) {
      throw new Error(`模型 "${model.id}" 的最大输出 Token 必须是正整数`)
    }
  }
  if (profile.apiKey !== undefined && profile.apiKey.trim() === '') {
    throw new Error('API Key 不能为空；如需删除，请使用清除操作')
  }
}

function recordOf(state: HarnessSessionState, scope: SessionScope): SessionRecord {
  const messages = projectMessages(state.events)
  const reasoning = projectReasoning(state.events)
  if (state.liveAssistant !== undefined) {
    if (state.liveAssistant.text !== '') {
      messages.push({
        id: `live-${state.liveAssistant.attemptId}`,
        role: 'assistant',
        text: state.liveAssistant.text,
        createdAt: state.liveAssistant.createdAt,
        state: state.liveAssistant.state,
        sequence: Number.MAX_SAFE_INTEGER,
        presentation: state.liveAssistant.presentation,
      })
    }
    if (state.liveAssistant.reasoning !== '') {
      reasoning.push({
        id: `live-reasoning-${state.liveAssistant.attemptId}`,
        text: state.liveAssistant.reasoning,
        createdAt: state.liveAssistant.createdAt,
        state: state.liveAssistant.state === 'streaming' ? 'streaming' : 'complete',
        sequence: Number.MAX_SAFE_INTEGER - 1,
      })
    }
  }
  const goalStatus = goalStatusOf(state.projections.goal)
  const planStatus = planStatusOf(state.projections.plan)
  return {
    id: state.id,
    scope,
    title: state.title,
    cwd: state.cwd,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    status: state.error ? 'error' : state.running ? 'running' : 'idle',
    ...(state.modelSelection === undefined
      ? {}
      : { modelSelection: structuredClone(state.modelSelection) }),
    ...(state.permissionSelection === undefined
      ? {}
      : { permissionSelection: structuredClone(state.permissionSelection) }),
    ...(goalStatus === undefined ? {} : { goalStatus }),
    ...(planStatus === undefined ? {} : { planStatus }),
    messages,
    reasoning,
    tools: projectToolCards(state.events),
    jobs: structuredClone(state.jobs),
  }
}

function nonnegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function contextStatusOf(state: HarnessSessionState): ContextStatus {
  const pressure = isRecord(state.projections.contextPressure) ? state.projections.contextPressure : {}
  const breakdown = isRecord(state.projections.contextBreakdown) ? state.projections.contextBreakdown : {}
  const usage = isRecord(state.projections.tokenUsage) ? state.projections.tokenUsage : {}
  const pressureTokens = nonnegative(pressure.pressureTokens)
  const projectedTokens = nonnegative(pressure.projectedTokens)
  const contextWindow = nonnegative(pressure.contextWindow)
  const compactions = new Map<string, CompactionRecord>()
  for (const event of state.events) {
    if (!event.type.startsWith('compaction/') || !isRecord(event.data)
      || typeof event.data.compactionId !== 'string') continue
    const id = event.data.compactionId
    if (event.type === 'compaction/start') {
      compactions.set(id, { id, status: 'running', startedAt: event.time })
      continue
    }
    const row = compactions.get(id)
    if (row === undefined) continue
    if (event.type === 'compaction/summary') {
      const shadowedTokenCount = nonnegative(event.data.shadowedTokenCount)
      if (shadowedTokenCount !== undefined) row.shadowedTokenCount = shadowedTokenCount
      if (typeof event.data.provider === 'string') row.provider = event.data.provider
      if (typeof event.data.model === 'string') row.model = event.data.model
    } else if (event.type === 'compaction/end') {
      row.status = typeof event.data.error === 'string' ? 'error' : 'complete'
      row.completedAt = event.time
      if (typeof event.data.error === 'string') row.error = event.data.error
    }
  }
  return {
    ...(pressureTokens === undefined ? {} : { pressureTokens }),
    ...(projectedTokens === undefined ? {} : { projectedTokens }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    systemTokens: nonnegative(breakdown.systemTokens) ?? 0,
    toolsTokens: nonnegative(breakdown.toolsTokens) ?? 0,
    messageTokens: nonnegative(breakdown.messageTokens) ?? 0,
    usage: {
      uncachedInputTokens: nonnegative(usage.uncachedInputTokens) ?? 0,
      outputTokens: nonnegative(usage.outputTokens) ?? 0,
      cacheReadTokens: nonnegative(usage.cacheReadTokens) ?? 0,
      cacheWriteTokens: nonnegative(usage.cacheWriteTokens) ?? 0,
    },
    compactions: [...compactions.values()].sort((left, right) => right.startedAt - left.startedAt),
  }
}

interface HarnessFileUploadValue {
  readonly receiptId: string
  readonly file: {
    readonly name: string
    readonly bytes: number
  }
}

const UPLOAD_CHUNK_BYTES = 24 * 1024

function uploadByteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, bytes.byteLength)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

type PromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'file'; readonly receiptId: string }

type CommandAttachment = { readonly type: 'file'; readonly receiptId: string }

interface HarnessCommandExecution {
  readonly result:
    | { readonly kind: 'success'; readonly text?: string }
    | { readonly kind: 'error'; readonly text: string }
}

function commandFailureMessage(command: string, detail: string): string {
  if (command === 'goal') {
    if (/A goal is already (?:active|paused|blocked)/iu.test(detail)) {
      return '当前已有一个目标。请先点击“目标”退出，再创建新目标。'
    }
    if (/objective is required|requires a replacement objective/iu.test(detail)) {
      return '请输入目标内容后重试。'
    }
    return '目标设置失败，请稍后重试。'
  }
  if (command === 'plan') return '计划模式切换失败，请稍后重试。'
  return '命令执行失败，请稍后重试。'
}

function requireCommandSuccess(
  execution: HarnessCommandExecution | undefined,
  unavailableMessage: string,
): HarnessCommandExecution {
  if (execution === undefined) throw new Error(unavailableMessage)
  if (execution.result.kind === 'error') throw new Error(execution.result.text)
  return execution
}

function compactResultOf(execution: HarnessCommandExecution | undefined): ContextCompactResult {
  const completed = requireCommandSuccess(execution, 'compact command is unavailable')
  return {
    status: completed.result.text === 'No compactable history yet.' ? 'unchanged' : 'complete',
  }
}

function submissionText(submission: ComposerSubmission): string {
  return [...submission.references.map(reference => reference.serializedText), submission.text.trim()]
    .filter(part => part !== '')
    .join(' ')
}

function promptContent(submission: ComposerSubmission): PromptContentPart[] {
  const text = submissionText(submission)
  return [
    ...submission.attachments.map(attachment => ({
      type: 'file' as const,
      receiptId: attachment.receiptId,
    })),
    ...(text === '' ? [] : [{ type: 'text' as const, text }]),
  ]
}

/** Product runtime backed by the fixed DeepSeek Harness Desktop Host API. */
export class HarnessAgentRuntime implements AgentRuntime {
  readonly mode = 'harness' as const
  private readonly client: HarnessHostClient
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()
  private readonly states = new Map<string, HarnessSessionState>()
  private readonly followers = new Map<string, AbortController>()
  private readonly followerReady = new Map<string, Promise<SessionRecord>>()
  private readonly pendingInteractions = new Map<string, PendingRemoteInteraction>()
  private readonly remoteEventsController = new AbortController()
  private readonly controlController = new AbortController()
  private readonly controlProjections = new Map<string, Record<string, unknown>>()
  private readonly controlJobs = new Map<string, BackgroundTask[]>()
  private archivedSessionIds = new Set<string>()
  private archivedSessionsLoaded = false
  private archivedSessionsLoading: Promise<void> | undefined
  private interactionAnswererAvailable = false
  private closed = false

  getHostStatus(): Promise<RuntimeHostStatus> {
    return Promise.resolve({ phase: 'ready' })
  }

  private constructor(
    private readonly host: HarnessHostProcess,
    private readonly scope: SessionScope,
    private readonly skillLibrary?: LocalSkillLibrary,
    private readonly resolveCredential: (ref: string) => Promise<string | undefined> = () => Promise.resolve(undefined),
  ) {
    this.client = new HarnessHostClient(host)
  }

  /** Start and validate the Host before exposing the runtime to Electron IPC. */
  static async create(
    host: HarnessHostProcess,
    scope: SessionScope = 'project',
    skillLibrary?: LocalSkillLibrary,
    resolveCredential?: (ref: string) => Promise<string | undefined>,
  ): Promise<HarnessAgentRuntime> {
    await host.start()
    const runtime = new HarnessAgentRuntime(host, scope, skillLibrary, resolveCredential)
    await Promise.all([runtime.startRemoteEvents(), runtime.startControlStream()])
    return runtime
  }

  async listSessions(): Promise<SessionSummary[]> {
    this.assertOpen()
    const [result] = await Promise.all([
      this.client.call<HarnessSessionList>('session/list', { _request: {} }),
      this.loadArchivedSessions(),
    ])
    return result.items
      .filter(summary => !this.archivedSessionIds.has(summary.sessionId))
      .map((summary) => {
      const existing = this.states.get(summary.sessionId)
      if (existing !== undefined) {
        existing.updatedAt = summary.updatedAt
        existing.running = summary.running
        existing.title = titleOf(summary, this.scope)
        if (summary.cwd !== undefined) existing.cwd = summary.cwd
      }
      const current = existing === undefined ? undefined : recordOf(existing, this.scope)
      return {
        id: summary.sessionId,
        scope: this.scope,
        title: titleOf(summary, this.scope),
        cwd: summary.cwd ?? '',
        updatedAt: summary.updatedAt,
        status: summary.running ? 'running' : 'idle',
        preview: current?.messages.at(-1)?.text ?? (summary.blank ? '空会话' : '打开查看会话'),
      }
    })
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    this.assertOpen()
    await this.loadArchivedSessions()
    if (this.archivedSessionIds.has(sessionId)) return undefined
    try {
      return await this.ensureFollower(sessionId)
    } catch (error) {
      if (error instanceof HarnessRemoteError && error.code === 'session/not-found') return undefined
      throw error
    }
  }

  async createSession(cwd: string): Promise<SessionRecord> {
    this.assertOpen()
    const result = await this.client.call<{ sessionId: string }>('session/create', {
      request: { cwd },
    })
    return this.ensureFollower(result.sessionId, cwd)
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.assertOpen()
    const session = await this.getSession(sessionId)
    if (session === undefined) return
    if (session.status === 'running') throw new Error('请先停止当前会话，再删除。')
    const result = await this.client.call<HarnessWorkspaceArchiveValue>('workspace/archiveSession', {
      request: { sessionId },
    })
    this.archivedSessionIds = new Set(result.archivedSessionIds)
    this.followers.get(sessionId)?.abort(new Error('Session removed from Harness Studio'))
    this.states.delete(sessionId)
    this.controlProjections.delete(sessionId)
    this.controlJobs.delete(sessionId)
    for (const [id, pending] of this.pendingInteractions) {
      if (pending.interaction.sessionId === sessionId) this.removeInteraction(id)
    }
  }

  async run(sessionId: string, submission: ComposerSubmission): Promise<RunReceipt> {
    this.assertOpen()
    const content = promptContent(submission)
    if (content.length === 0) throw new Error('任务内容不能为空')
    await this.ensureFollower(sessionId)
    const requestId = randomUUID()
    await this.client.call<{ accepted: true }>('session/prompt', {
      request: {
        requestId,
        sessionId,
        mode: 'queue',
        content,
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    })
    return { messageId: requestId }
  }

  async cancel(sessionId: string): Promise<void> {
    this.assertOpen()
    await this.client.call<{ accepted: true }>('session/cancel', {
      request: { sessionId },
    })
  }

  async listCommands(sessionId: string): Promise<CommandSummary[]> {
    this.assertOpen()
    await this.ensureFollower(sessionId)
    const descriptors = await this.client.call<readonly {
      name: string
      description: string
    }[]>('commands/list', { agentId: sessionId })
    return descriptors
      .filter(descriptor => typeof descriptor.name === 'string' && typeof descriptor.description === 'string')
      .map(descriptor => ({ name: descriptor.name, description: descriptor.description }))
  }

  async runCommand(sessionId: string, submission: ComposerCommandSubmission): Promise<void> {
    this.assertOpen()
    const command = submission.command.trim().replace(/^\//u, '')
    if (command === '') throw new Error('请选择要运行的命令')
    await this.ensureFollower(sessionId)
    const suffix = submissionText(submission)
    const attachments: CommandAttachment[] = submission.attachments.map(attachment => ({
      type: 'file',
      receiptId: attachment.receiptId,
    }))
    const execution = await this.client.call<HarnessCommandExecution | undefined>('commands/execute', {
      agentId: sessionId,
      line: `/${command}${suffix === '' ? '' : ` ${suffix}`}`,
      submittedAttachments: attachments,
    })
    if (execution === undefined) throw new Error('当前会话不支持该命令')
    if (execution.result.kind === 'error') {
      console.error(`Harness command /${command} failed:`, execution.result.text)
      throw new Error(commandFailureMessage(command, execution.result.text))
    }
  }

  async uploadFile(sessionId: string, path: string): Promise<ComposerFileAttachment> {
    this.assertOpen()
    await this.ensureFollower(sessionId)
    const query = new URLSearchParams({ sessionId, name: basename(path) })
    const stream = Readable.toWeb(createReadStream(path, {
      highWaterMark: UPLOAD_CHUNK_BYTES,
    })) as ReadableStream<Uint8Array>
    const uploaded = await this.client.postStream<HarnessFileUploadValue>(
      `/api/session/uploadFileBinary?${query.toString()}`,
      stream,
      { 'content-type': 'application/octet-stream' },
    )
    return {
      receiptId: uploaded.receiptId,
      name: uploaded.file.name,
      bytes: uploaded.file.bytes,
    }
  }

  async uploadImage(sessionId: string, image: ComposerImageUpload): Promise<ComposerFileAttachment> {
    this.assertOpen()
    await this.ensureFollower(sessionId)
    const query = new URLSearchParams({ sessionId, name: image.name })
    const stream = uploadByteStream(image.bytes)
    const uploaded = await this.client.postStream<HarnessFileUploadValue>(
      `/api/session/uploadFileBinary?${query.toString()}`,
      stream,
      { 'content-type': 'application/octet-stream' },
    )
    return {
      receiptId: uploaded.receiptId,
      name: uploaded.file.name,
      bytes: uploaded.file.bytes,
    }
  }

  async listWorkspaceFiles(sessionId: string, query: string): Promise<FileCandidate[]> {
    this.assertOpen()
    if (typeof query !== 'string') throw new Error('文件补全请求缺少查询文本')
    await this.ensureFollower(sessionId)
    return this.client.call<FileCandidate[]>('fileReferences/list', {
      agentId: sessionId,
      query,
    })
  }

  async selectModel(sessionId: string, selection: ModelSelection): Promise<ModelSelection> {
    this.assertOpen()
    const result = await this.client.call<{ selected: ModelSelection }>('session/selectModel', {
      request: {
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selection.reasoningEffort }),
      },
    })
    const state = this.states.get(sessionId)
    if (state !== undefined) {
      state.modelSelection = structuredClone(result.selected)
      this.publish(state)
    }
    return result.selected
  }

  async getModelConfiguration(): Promise<ModelConfiguration> {
    this.assertOpen()
    let [catalog, settings] = await Promise.all([
      this.client.call<HarnessModelCatalog>('session/modelCatalog', {}),
      this.client.call<HarnessSettingsDescription>('settings/describe', {}),
    ])
    const profilePolicyOps = Object.entries(rawProfiles(settings)).flatMap(([id, profile]) => {
      const ops: Array<{ op: 'set'; path: string[]; value: unknown }> = []
      if (profile.streamIdleTimeoutMs !== MODEL_STREAM_IDLE_TIMEOUT_MS) {
        ops.push({
          op: 'set',
          path: ['providers', id, 'streamIdleTimeoutMs'],
          value: MODEL_STREAM_IDLE_TIMEOUT_MS,
        })
      }
      const models = profile.models ?? []
      let modelsChanged = false
      const inferredDefaults: string[] = []
      const nextModels = models.map(model => {
        if (typeof model.id !== 'string' || !isModelProtocol(profile.api)) return model
        const inferred = inferReasoningProfile(model.id, profile.api)
        const inferredInput = inferInputModalities(model.id)
        if (inferred !== undefined) inferredDefaults.push(inferred.defaultEffort)
        const reasoningCurrent = inferred === undefined
          || sameReasoningEfforts(model.reasoningEfforts, inferred.efforts)
        const inputCurrent = inferredInput === undefined
          || sameInputModalities(model.input, inferredInput)
        if (reasoningCurrent && inputCurrent) return model
        modelsChanged = true
        return {
          ...model,
          ...(inferred === undefined ? {} : { reasoningEfforts: inferred.efforts }),
          ...(inferredInput === undefined ? {} : { input: inferredInput }),
        }
      })
      if (modelsChanged) {
        ops.push({
          op: 'set',
          path: ['providers', id, 'models'],
          value: nextModels,
        })
      }
      const commonDefault = inferredDefaults[0]
      if (profile.reasoning === undefined
        && models.length > 0
        && inferredDefaults.length === models.length
        && commonDefault !== undefined
        && inferredDefaults.every(effort => effort === commonDefault)) {
        ops.push({
          op: 'set',
          path: ['providers', id, 'reasoning'],
          value: commonDefault,
        })
      }
      return ops
    })
    if (settings.writable && profilePolicyOps.length > 0) {
      const section = namespaceValue(settings, 'llm-pi-ai')
      await this.client.call('settings/mutate', {
        ns: 'llm-pi-ai',
        ops: profilePolicyOps,
        expectedRevision: section.revision,
      })
      ;[catalog, settings] = await Promise.all([
        this.client.call<HarnessModelCatalog>('session/modelCatalog', {}),
        this.client.call<HarnessSettingsDescription>('settings/describe', {}),
      ])
    }
    const profiles = rawProfiles(settings)
    const credentialRefs = new Set(['DEEPSEEK_API_KEY'])
    for (const [id, profile] of Object.entries(profiles)) {
      credentialRefs.add(typeof profile.apiKeyEnv === 'string'
        ? profile.apiKeyEnv
        : credentialRefForProfile(id))
    }
    const credentials = await this.client.call<Record<string, HarnessCredentialInfo>>('credentials/describe', {
      refs: [...credentialRefs],
    })
    const deepSeek = namespaceValue(settings, 'llm-deepseek').value
    const credential = credentials.DEEPSEEK_API_KEY
    return {
      available: catalog.groups.some(group => group.models.length > 0),
      writable: settings.writable,
      credentialConfigured: credential?.configured ?? false,
      ...(credential?.source === undefined ? {} : { credentialSource: credential.source }),
      credentialWritable: credential?.writable ?? false,
      baseURL: typeof deepSeek.baseURL === 'string'
        ? deepSeek.baseURL
        : 'https://api.deepseek.com',
      maxTokens: typeof deepSeek.maxTokens === 'number'
        ? deepSeek.maxTokens
        : 256_000,
      defaultSelection: catalog.default,
      groups: modelGroups(catalog),
      profiles: configuredProfiles(settings, credentials),
      failures: catalog.failures.map(failure => ({ ...failure })),
    }
  }

  async updateModelConfiguration(update: ModelConfigurationUpdate): Promise<ModelConfiguration> {
    this.assertOpen()
    validateModelUpdate(update)
    if (update.apiKey !== undefined) {
      await this.client.call<void>('credentials/set', {
        ref: 'DEEPSEEK_API_KEY',
        value: update.apiKey,
      })
    } else if (update.clearApiKey === true) {
      await this.client.call<void>('credentials/unset', {
        ref: 'DEEPSEEK_API_KEY',
      })
    }

    const settings = await this.client.call<HarnessSettingsDescription>('settings/describe', {})
    const deepSeek = namespaceValue(settings, 'llm-deepseek')
    const adapterPatch: Record<string, unknown> = {}
    if (update.baseURL !== undefined) adapterPatch.baseURL = update.baseURL
    if (update.maxTokens !== undefined) adapterPatch.maxTokens = update.maxTokens
    if (Object.keys(adapterPatch).length > 0) {
      await this.client.call('settings/update', {
        ns: 'llm-deepseek',
        patch: adapterPatch,
        expectedRevision: deepSeek.revision,
      })
    }

    if (update.upsertProfile !== undefined) {
      const profile = update.upsertProfile
      const section = namespaceValue(settings, 'llm-pi-ai')
      const credentialRef = credentialRefForProfile(profile.id)
      const changesCredential = profile.apiKey !== undefined || profile.clearApiKey === true
      if (changesCredential) {
        const described = await this.client.call<Record<string, HarnessCredentialInfo>>('credentials/describe', {
          refs: [credentialRef],
        })
        if (described[credentialRef]?.writable !== true) {
          throw new Error('当前凭据来源不可写，无法修改 API Key')
        }
      }
      const previousProfile = rawProfiles(settings)[profile.id]
      const previousModels = new Map((previousProfile?.models ?? [])
        .flatMap(model => typeof model.id === 'string' ? [[model.id, model] as const] : []))
      const models = profile.models.map(model => {
        const id = model.id.trim()
        const previous = previousModels.get(id)
        const inferred = inferReasoningProfile(id, profile.protocol)
        const inferredInput = inferInputModalities(id)
        return {
          id,
          name: model.name.trim() === '' ? id : model.name.trim(),
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          input: inferredInput ?? previous?.input ?? ['text'],
          ...(inferred !== undefined
            ? { reasoningEfforts: inferred.efforts }
            : previous?.reasoningEfforts === undefined
              ? {}
              : { reasoningEfforts: previous.reasoningEfforts }),
        }
      })
      const inferredDefaults = models.flatMap(model => {
        const inferred = inferReasoningProfile(model.id, profile.protocol)
        return inferred === undefined ? [] : [inferred.defaultEffort]
      })
      const commonDefault = inferredDefaults[0]
      await this.client.call('settings/mutate', {
        ns: 'llm-pi-ai',
        ops: [{
          op: 'set',
          path: ['providers', profile.id],
          value: {
            displayName: profile.displayName.trim(),
            apiKeyEnv: credentialRef,
            api: profile.protocol,
            baseURL: profile.baseURL.trim(),
            streamIdleTimeoutMs: MODEL_STREAM_IDLE_TIMEOUT_MS,
            ...(previousProfile?.reasoning !== undefined
              ? { reasoning: previousProfile.reasoning }
              : models.length > 0
                && inferredDefaults.length === models.length
                && commonDefault !== undefined
                && inferredDefaults.every(effort => effort === commonDefault)
                ? { reasoning: commonDefault }
                : {}),
            models,
          },
        }],
        expectedRevision: section.revision,
      })
      try {
        if (profile.apiKey !== undefined) {
          await this.client.call<void>('credentials/set', {
            ref: credentialRef,
            value: profile.apiKey,
          })
        } else if (profile.clearApiKey === true) {
          await this.client.call<void>('credentials/unset', { ref: credentialRef })
        }
      } catch {
        try {
          const latest = await this.client.call<HarnessSettingsDescription>('settings/describe', {})
          const latestSection = namespaceValue(latest, 'llm-pi-ai')
          await this.client.call('settings/mutate', {
            ns: 'llm-pi-ai',
            ops: previousProfile === undefined
              ? [{ op: 'unset', path: ['providers', profile.id] }]
              : [{ op: 'set', path: ['providers', profile.id], value: previousProfile }],
            expectedRevision: latestSection.revision,
          })
        } catch {
          throw new Error('API Key 保存失败，模型接口配置回滚失败；请重新打开设置检查状态')
        }
        throw new Error('API Key 保存失败，模型接口配置已回滚')
      }
    }

    if (update.removeProfileId !== undefined) {
      const section = namespaceValue(settings, 'llm-pi-ai')
      const existing = rawProfiles(settings)[update.removeProfileId]
      const credentialRef = typeof existing?.apiKeyEnv === 'string'
        ? existing.apiKeyEnv
        : credentialRefForProfile(update.removeProfileId)
      await this.client.call('settings/mutate', {
        ns: 'llm-pi-ai',
        ops: [{ op: 'unset', path: ['providers', update.removeProfileId] }],
        expectedRevision: section.revision,
      })
      const described = await this.client.call<Record<string, HarnessCredentialInfo>>('credentials/describe', {
        refs: [credentialRef],
      })
      if (described[credentialRef]?.writable === true) {
        try {
          await this.client.call<void>('credentials/unset', { ref: credentialRef })
        } catch {
          try {
            const latest = await this.client.call<HarnessSettingsDescription>('settings/describe', {})
            const latestSection = namespaceValue(latest, 'llm-pi-ai')
            if (existing !== undefined) {
              await this.client.call('settings/mutate', {
                ns: 'llm-pi-ai',
                ops: [{ op: 'set', path: ['providers', update.removeProfileId], value: existing }],
                expectedRevision: latestSection.revision,
              })
            }
          } catch {
            throw new Error('API Key 删除失败，模型接口配置回滚失败；请重新打开设置检查状态')
          }
          throw new Error('API Key 删除失败，模型接口配置已回滚')
        }
      }
    }

    if (update.defaultSelection !== undefined) {
      const defaults = namespaceValue(settings, 'agent-default-model')
      await this.client.call('settings/replace', {
        ns: 'agent-default-model',
        section: {
          provider: update.defaultSelection.provider,
          model: update.defaultSelection.model,
          ...(update.defaultSelection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: update.defaultSelection.reasoningEffort }),
        },
        expectedRevision: defaults.revision,
      })
    }
    return this.getModelConfiguration()
  }

  async discoverModels(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResult> {
    this.assertOpen()
    validateProviderProfile({
      id: request.providerId ?? 'discovery',
      displayName: 'Discovery',
      protocol: request.protocol,
      baseURL: request.baseURL,
      models: [{ id: 'discovery', name: 'Discovery', contextWindow: 1, maxTokens: 1 }],
      ...(request.apiKey === undefined ? {} : { apiKey: request.apiKey }),
    })
    const discovered = await this.client.call<HarnessDiscoveredModel[]>('llm/discoverModels', {
      settingsNs: 'llm-pi-ai',
      request: {
        ...(request.providerId === undefined ? {} : { provider: request.providerId }),
        baseURL: request.baseURL,
        api: request.protocol,
        ...(request.apiKey === undefined ? {} : { apiKey: request.apiKey }),
      },
    })
    return {
      models: discovered.map(model => ({
        id: model.id,
        name: model.name ?? model.id,
        contextWindow: model.contextWindow ?? 262_144,
        maxTokens: model.maxTokens ?? 32_768,
      })),
    }
  }

  async testModel(request: ModelTestRequest): Promise<ModelTestResult> {
    this.assertOpen()
    if (request.providerId.trim() === '' || request.modelId.trim() === '') {
      throw new Error('模型测试请求缺少接口或模型 ID')
    }
    const settings = await this.client.call<HarnessSettingsDescription>('settings/describe', {})
    const profile = rawProfiles(settings)[request.providerId]
    if (profile === undefined || !isModelProtocol(profile.api) || typeof profile.baseURL !== 'string') {
      throw new Error('要测试的模型接口不存在')
    }
    const model = profile.models?.find(candidate => candidate.id === request.modelId)
    if (model === undefined) throw new Error('要测试的模型不存在')
    const credentialRef = typeof profile.apiKeyEnv === 'string'
      ? profile.apiKeyEnv
      : credentialRefForProfile(request.providerId)
    const apiKey = await this.resolveCredential(credentialRef) ?? ''
    return testModelConnection({
      protocol: profile.api,
      baseURL: profile.baseURL,
      model: request.modelId,
      apiKey,
    })
  }

  async listSkills(sessionId: string): Promise<SkillEntry[]> {
    this.assertOpen()
    const [remote, managed] = await Promise.all([
      this.client.call<{
        skills: Array<{
          name: string
          description: string
          whenToUse?: string
          path?: string
          modelInvocable: boolean
        }>
      }>('skills/list', { request: { sessionId } }),
      this.skillLibrary?.list() ?? Promise.resolve([]),
    ])
    const rows = new Map<string, SkillEntry>()
    for (const skill of remote.skills) {
      const managedSkill = managed.find(candidate => candidate.name === skill.name)
      rows.set(skill.name, {
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        ...(skill.path === undefined ? {} : { path: skill.path }),
        modelInvocable: skill.modelInvocable,
        userInvocable: true,
        enabled: true,
        managed: managedSkill !== undefined || this.skillLibrary?.isManagedPath(skill.path) === true,
        source: managedSkill !== undefined
          ? 'user'
          : skill.path?.includes('/.dsh/skills/') === true || skill.path?.includes('/.agents/skills/') === true
            ? 'project'
            : 'runtime',
      })
    }
    for (const skill of managed) rows.set(skill.name, { ...skill })
    return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  async importSkill(sessionId: string, sourcePath: string): Promise<SkillEntry> {
    this.assertOpen()
    await this.ensureFollower(sessionId)
    if (this.skillLibrary === undefined) throw new Error('当前运行时没有可写 Skill 目录')
    return this.skillLibrary.import(sourcePath)
  }

  async setSkillEnabled(sessionId: string, name: string, enabled: boolean): Promise<SkillEntry[]> {
    this.assertOpen()
    await this.ensureFollower(sessionId)
    if (this.skillLibrary === undefined) throw new Error('当前运行时没有可写 Skill 目录')
    await this.skillLibrary.setEnabled(name, enabled)
    return this.listSkills(sessionId)
  }

  listPendingInteractions(): Promise<PendingInteraction[]> {
    return Promise.resolve([...this.pendingInteractions.values()]
      .map(pending => structuredClone(pending.interaction)))
  }

  async getPermissionSelection(sessionId: string): Promise<PermissionSelection | undefined> {
    const session = await this.ensureFollower(sessionId)
    return session.permissionSelection
  }

  async selectPermissionPreset(sessionId: string, preset: string): Promise<PermissionSelection> {
    await this.ensureFollower(sessionId)
    const state = this.states.get(sessionId)
    if (state === undefined) throw new Error('会话尚未加载')
    const selection = state.permissionSelection
    if (selection === undefined) throw new Error('当前会话未提供权限模式')
    if (!selection.options.some(option => option.value === preset) || preset === 'custom') {
      throw new Error('所选权限模式不可用，请重新选择。')
    }
    if (selection.currentValue === preset) return structuredClone(selection)

    const confirmation = this.waitForPermissionPreset(sessionId, preset)
    try {
      const execution = await this.client.call<HarnessCommandExecution | undefined>('commands/execute', {
        agentId: sessionId,
        line: `/permission ${preset}`,
        submittedAttachments: [],
      })
      requireCommandSuccess(execution, 'permission command is unavailable')
      return await confirmation.promise
    } catch (reason) {
      console.error(`Harness permission preset switch to ${preset} failed:`, reason)
      throw new Error('权限切换失败，请稍后重试。')
    } finally {
      confirmation.cancel()
    }
  }

  setInteractionAnswererAvailable(available: boolean): void {
    this.interactionAnswererAvailable = available
    if (available) return
    for (const pending of [...this.pendingInteractions.values()]) {
      void this.replyInteraction(pending, { kind: 'next' }).catch(() => this.removeInteraction(pending.eventId))
    }
  }

  async answerApproval(interactionId: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.requireInteraction(interactionId, 'approval')
    await this.replyInteraction(pending, { kind: 'result', value: decision })
  }

  async answerQuestions(interactionId: string, answers: QuestionAnswer[]): Promise<void> {
    const pending = this.requireInteraction(interactionId, 'questions')
    const expected = new Map(pending.interaction.questions.map(question => [question.id, question]))
    if (answers.length !== expected.size || answers.some(answer => {
      const question = expected.get(answer.id)
      if (question === undefined || !expected.delete(answer.id) || !Array.isArray(answer.selected)) return true
      const labels = new Set(question.options.map(option => option.label))
      return answer.selected.some(label => typeof label !== 'string' || !labels.has(label))
        || (!question.multiSelect && answer.selected.length > 1)
        || (answer.custom !== undefined && typeof answer.custom !== 'string')
    })) {
      throw new Error('问题答案与待处理问题不匹配')
    }
    await this.replyInteraction(pending, { kind: 'result', value: { answers } })
  }

  async cancelInteraction(interactionId: string): Promise<void> {
    const pending = this.pendingInteractions.get(interactionId)
    if (pending === undefined) return
    if (pending.interaction.kind === 'approval') {
      await this.replyInteraction(pending, { kind: 'result', value: 'cancelled' })
      return
    }
    await this.replyInteraction(pending, {
      kind: 'rejected',
      error: { name: 'UserQuestionError', message: '用户取消了问题', code: 'ASK_CANCELLED' },
    })
  }

  async getContextStatus(sessionId: string): Promise<ContextStatus> {
    await this.ensureFollower(sessionId)
    const state = this.states.get(sessionId)
    if (state === undefined) throw new Error('会话尚未加载')
    return contextStatusOf(state)
  }

  async compactContext(sessionId: string): Promise<ContextCompactResult> {
    await this.ensureFollower(sessionId)
    const execution = await this.client.call<HarnessCommandExecution | undefined>('commands/execute', {
      agentId: sessionId,
      line: '/compact',
      submittedAttachments: [],
    })
    return compactResultOf(execution)
  }

  async listScheduledTasks(): Promise<ScheduledTask[]> {
    return this.client.call<ScheduledTask[]>('scheduledTasks/list', {})
  }

  async createScheduledTask(input: ScheduledTaskInput): Promise<ScheduledTask> {
    return this.client.call<ScheduledTask>('scheduledTasks/create', { input })
  }

  async updateScheduledTask(input: ScheduledTaskUpdate): Promise<ScheduledTask> {
    return this.client.call<ScheduledTask>('scheduledTasks/update', { input })
  }

  async removeScheduledTask(id: string): Promise<void> {
    await this.client.call<void>('scheduledTasks/remove', { id })
  }

  async setScheduledTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    return this.client.call<ScheduledTask>('scheduledTasks/setEnabled', { id, enabled })
  }

  async runScheduledTaskNow(id: string): Promise<ScheduledTaskRun> {
    return this.client.call<ScheduledTaskRun>('scheduledTasks/runNow', { id })
  }

  async cancelScheduledTaskRun(id: string): Promise<void> {
    await this.client.call<void>('scheduledTasks/cancelRun', { id })
  }

  async listScheduledTaskRuns(taskId: string, limit?: number): Promise<ScheduledTaskRun[]> {
    return this.client.call<ScheduledTaskRun[]>('scheduledTasks/runs', { taskId, limit })
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.remoteEventsController.abort(new Error('Harness Studio is closing'))
    this.controlController.abort(new Error('Harness Studio is closing'))
    for (const controller of this.followers.values()) {
      controller.abort(new Error('Harness Studio is closing'))
    }
    this.followers.clear()
    await Promise.allSettled([...this.followerReady.values()])
    this.followerReady.clear()
    await this.host.stop()
  }

  private async startRemoteEvents(): Promise<void> {
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    let readySettled = false
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    void this.pumpRemoteEvents(this.remoteEventsController.signal, () => {
      if (readySettled) return
      readySettled = true
      resolveReady()
    }).catch((reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      if (!readySettled) {
        readySettled = true
        rejectReady(error)
      } else if (!this.remoteEventsController.signal.aborted) {
        console.error('Harness Remote Events stopped:', error)
      }
      for (const id of [...this.pendingInteractions.keys()]) this.removeInteraction(id)
    })
    return ready
  }

  private async startControlStream(): Promise<void> {
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    let readySettled = false
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    void this.pumpControl(this.controlController.signal, () => {
      if (readySettled) return
      readySettled = true
      resolveReady()
    }).catch((reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      if (!readySettled) {
        readySettled = true
        rejectReady(error)
      } else if (!this.controlController.signal.aborted) {
        console.error('Harness control stream stopped:', error)
      }
    })
    return ready
  }

  private async pumpControl(signal: AbortSignal, ready: () => void): Promise<void> {
    let opened = false
    for await (const frame of this.client.stream<HarnessControlFrame>('session/control', {}, signal)) {
      if (!opened) {
        if (frame.type !== 'baseline') throw new TypeError('Harness control stream did not begin with a baseline')
        opened = true
        for (const [sessionId, projection] of Object.entries(frame.value.projections ?? {})) {
          this.controlProjections.set(sessionId, structuredClone(projection.values ?? {}))
        }
        for (const [sessionId, jobs] of Object.entries(frame.value.jobs ?? {})) {
          this.controlJobs.set(sessionId, jobs.map(job => structuredClone(job)))
        }
        ready()
        continue
      }
      if (frame.type === 'projection') {
        const projections = this.controlProjections.get(frame.sessionId) ?? {}
        projections[frame.key] = structuredClone(frame.value)
        this.controlProjections.set(frame.sessionId, projections)
        const state = this.states.get(frame.sessionId)
        if (state !== undefined) {
          state.projections[frame.key] = structuredClone(frame.value)
          if (frame.key === 'permissions') {
            const selection = permissionSelectionOf(frame.value)
            if (selection !== undefined) state.permissionSelection = selection
          }
          this.publish(state)
        }
      } else if (frame.type === 'jobs') {
        const jobs = frame.jobs.map(job => structuredClone(job))
        this.controlJobs.set(frame.sessionId, jobs)
        const state = this.states.get(frame.sessionId)
        if (state !== undefined) {
          state.jobs = jobs
          this.publish(state)
        }
      }
    }
    if (!signal.aborted) throw new Error('Harness control stream ended unexpectedly')
  }

  private async pumpRemoteEvents(signal: AbortSignal, ready: () => void): Promise<void> {
    let clientId: string | undefined
    for await (const frame of this.client.stream<RemoteEventFrame>('$events', {}, signal)) {
      if (clientId === undefined) {
        if (frame.type !== 'ready' || typeof frame.clientId !== 'string') {
          throw new TypeError('Harness Remote Events did not begin with a ready frame')
        }
        clientId = frame.clientId
        ready()
        continue
      }
      if (frame.type === 'cancel' && typeof frame.eventId === 'string') {
        this.removeInteraction(frame.eventId)
        continue
      }
      if (frame.type !== 'waterfall'
        || typeof frame.eventId !== 'string'
        || typeof frame.event !== 'string'
        || typeof frame.agentId !== 'string'
        || !isRecord(frame.request)) continue
      const interaction = this.interactionOf(frame.eventId, frame.event, frame.agentId, frame.request)
      if (interaction === undefined || !this.interactionAnswererAvailable) {
        await this.client.call<void>('$events/result', {
          clientId,
          eventId: frame.eventId,
          outcome: { kind: 'next' },
        }, signal)
        continue
      }
      this.pendingInteractions.set(frame.eventId, {
        interaction,
        clientId,
        eventId: frame.eventId,
      })
      this.emit({ type: 'interaction-requested', interaction: structuredClone(interaction) })
    }
    if (!signal.aborted) throw new Error('Harness Remote Events stream ended unexpectedly')
  }

  private interactionOf(
    id: string,
    event: string,
    sessionId: string,
    request: Record<string, unknown>,
  ): PendingInteraction | undefined {
    if (event === 'approval/request' && typeof request.toolName === 'string') {
      return {
        id,
        kind: 'approval',
        sessionId,
        toolName: request.toolName,
        ...(typeof request.callId === 'string' ? { callId: request.callId } : {}),
        ...(typeof request.reason === 'string' ? { reason: request.reason } : {}),
      }
    }
    if (event !== 'user-questions/request' || !Array.isArray(request.questions)) return undefined
    const questions = request.questions.flatMap((candidate): QuestionItem[] => {
      if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.question !== 'string') return []
      const options = Array.isArray(candidate.options)
        ? candidate.options.flatMap(option => isRecord(option) && typeof option.label === 'string'
          ? [{ label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) }]
          : [])
        : []
      return [{
        id: candidate.id,
        question: candidate.question,
        ...(typeof candidate.detail === 'string' ? { detail: candidate.detail } : {}),
        ...(typeof candidate.header === 'string' ? { header: candidate.header } : {}),
        options,
        multiSelect: candidate.multiSelect === true,
      }]
    })
    if (questions.length !== request.questions.length) return undefined
    return { id, kind: 'questions', sessionId, questions }
  }

  private requireInteraction<T extends PendingInteraction['kind']>(
    id: string,
    kind: T,
  ): PendingRemoteInteraction & { interaction: Extract<PendingInteraction, { kind: T }> } {
    const pending = this.pendingInteractions.get(id)
    if (pending === undefined || pending.interaction.kind !== kind) throw new Error('待处理交互不存在或已经结束')
    return pending as PendingRemoteInteraction & { interaction: Extract<PendingInteraction, { kind: T }> }
  }

  private async replyInteraction(
    pending: PendingRemoteInteraction,
    outcome: Record<string, unknown>,
  ): Promise<void> {
    await this.client.call<void>('$events/result', {
      clientId: pending.clientId,
      eventId: pending.eventId,
      outcome,
    })
    this.removeInteraction(pending.eventId)
  }

  private removeInteraction(id: string): void {
    if (!this.pendingInteractions.delete(id)) return
    this.emit({ type: 'interaction-cancelled', interactionId: id })
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private loadArchivedSessions(): Promise<void> {
    if (this.archivedSessionsLoaded) return Promise.resolve()
    if (this.archivedSessionsLoading !== undefined) return this.archivedSessionsLoading
    const loading = this.readArchivedSessions().finally(() => {
      if (this.archivedSessionsLoading === loading) this.archivedSessionsLoading = undefined
    })
    this.archivedSessionsLoading = loading
    return loading
  }

  private async readArchivedSessions(): Promise<void> {
    const controller = new AbortController()
    const iterator = this.client.stream<HarnessWorkspaceFollowFrame>(
      'workspace/follow',
      {},
      controller.signal,
    )[Symbol.asyncIterator]()
    try {
      const opening = await iterator.next()
      if (opening.done || opening.value.type !== 'baseline'
        || !Array.isArray(opening.value.value?.archivedSessionIds)) {
        throw new TypeError('Harness Workspace stream did not begin with an archive baseline')
      }
      this.archivedSessionIds = new Set(opening.value.value.archivedSessionIds)
      this.archivedSessionsLoaded = true
    } finally {
      controller.abort(new Error('Workspace archive baseline loaded'))
      await iterator.return?.(undefined)
    }
  }

  private ensureFollower(sessionId: string, fallbackCwd = ''): Promise<SessionRecord> {
    const state = this.states.get(sessionId)
    if (state !== undefined && this.followers.has(sessionId)) return Promise.resolve(recordOf(state, this.scope))
    const existing = this.followerReady.get(sessionId)
    if (existing !== undefined) return existing

    const controller = new AbortController()
    this.followers.set(sessionId, controller)
    let resolveReady!: (record: SessionRecord) => void
    let rejectReady!: (error: Error) => void
    let settled = false
    const ready = new Promise<SessionRecord>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    this.followerReady.set(sessionId, ready)
    void this.follow(sessionId, fallbackCwd, controller.signal, (record) => {
      if (settled) return
      settled = true
      resolveReady(record)
    }).catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (!settled) {
        settled = true
        rejectReady(failure)
      }
      if (!controller.signal.aborted) {
        const failed = this.states.get(sessionId)
        if (failed !== undefined) {
          failed.error = true
          failed.running = false
          this.publish(failed)
        }
      }
    }).finally(() => {
      if (this.followers.get(sessionId) === controller) this.followers.delete(sessionId)
      this.followerReady.delete(sessionId)
    })
    return ready
  }

  private async follow(
    sessionId: string,
    fallbackCwd: string,
    signal: AbortSignal,
    ready: (record: SessionRecord) => void,
  ): Promise<void> {
    for await (const frame of this.client.stream<HarnessFollowFrame>(
      'session/follow',
      {
        request: {
          address: { kind: 'session', sessionId },
          assistantStream: true,
        },
      },
      signal,
    )) {
      let state = this.states.get(sessionId)
      if (frame.type === 'snapshot') {
        const projections = {
          ...structuredClone(frame.projections.values ?? {}),
          ...structuredClone(this.controlProjections.get(sessionId) ?? {}),
        }
        const projectedTitle = projections.title
        const projectedModel = projections.modelSelection
        const projectedPermissions = permissionSelectionOf(projections.permissions)
        const nextModel = isRecord(projectedModel) && isRecord(projectedModel.next)
          && typeof projectedModel.next.provider === 'string'
          && typeof projectedModel.next.model === 'string'
          ? {
            provider: projectedModel.next.provider,
            model: projectedModel.next.model,
            ...(typeof projectedModel.next.reasoningEffort === 'string'
              ? { reasoningEffort: projectedModel.next.reasoningEffort }
              : {}),
          }
          : undefined
        state = {
          id: sessionId,
          cwd: frame.header.cwd ?? fallbackCwd,
          createdAt: frame.header.createdAt,
          updatedAt: frame.records.at(-1)?.event.time ?? frame.header.createdAt,
          title: typeof projectedTitle === 'string' && projectedTitle !== ''
            ? projectedTitle
            : this.scope === 'daily'
              ? '新对话'
              : `新任务 · ${basename(frame.header.cwd ?? fallbackCwd)}`,
          running: frame.assistantStream?.activeAttempt !== undefined,
          error: false,
          ...(nextModel === undefined ? {} : { modelSelection: nextModel }),
          ...(projectedPermissions === undefined ? {} : { permissionSelection: projectedPermissions }),
          projections,
          jobs: structuredClone(this.controlJobs.get(sessionId) ?? []),
          events: frame.records.map(record => record.event),
          ...(frame.assistantStream?.activeAttempt === undefined ? {} : {
            liveAssistant: {
              attemptId: frame.assistantStream.activeAttempt.attemptId,
              text: embeddedText(frame.assistantStream.activeAttempt.stream),
              reasoning: embeddedReasoning(frame.assistantStream.activeAttempt.stream, Date.now())?.text ?? '',
              createdAt: Date.now(),
              state: 'streaming' as const,
              presentation: containsToolCall(frame.assistantStream.activeAttempt.stream) ? 'activity' : 'answer',
            },
          }),
        }
        this.states.set(sessionId, state)
        const record = this.publish(state)
        ready(record)
        continue
      }
      if (state === undefined) continue
      if (frame.type === 'projection') {
        state.projections[frame.key] = structuredClone(frame.value)
        if (frame.key === 'permissions') {
          const selection = permissionSelectionOf(frame.value)
          if (selection !== undefined) state.permissionSelection = selection
        }
        this.publish(state)
        continue
      }
      if (frame.type === 'event') {
        if (!state.events.some(event => event.seq === frame.event.seq)) {
          state.events.push(frame.event)
          state.events.sort((left, right) => left.seq - right.seq)
        }
        state.updatedAt = Math.max(state.updatedAt, frame.event.time)
        if (frame.event.type === 'turn/start') {
          state.running = true
          state.error = false
        }
        if (frame.event.type === 'turn/end') {
          state.running = false
          state.error = isRecord(frame.event.data)
            && turnFailureMessage(frame.event.data.reason) !== undefined
          delete state.liveAssistant
        }
        if (frame.event.type === 'assistant/message' || frame.event.type === 'assistant/attempt') {
          delete state.liveAssistant
        }
        if (frame.event.type === 'session/title' && isRecord(frame.event.data)
          && typeof frame.event.data.title === 'string') {
          state.title = frame.event.data.title
        }
        this.publish(state)
        continue
      }
      this.acceptAssistantFrame(state, frame.frame)
      this.publish(state)
    }
  }

  private acceptAssistantFrame(state: HarnessSessionState, frame: HarnessAssistantFrame): void {
    if (frame.type === 'start') {
      state.running = true
      state.liveAssistant = {
        attemptId: frame.attemptId,
        text: '',
        reasoning: '',
        createdAt: Date.now(),
        state: 'streaming',
        presentation: 'answer',
      }
      return
    }
    const live = state.liveAssistant
    if (live === undefined || live.attemptId !== frame.attemptId) return
    if (frame.type === 'chunk') {
      live.text += textDelta(frame.chunk)
      live.reasoning += reasoningDelta(frame.chunk)
      if (containsToolCall(frame.chunk)) live.presentation = 'activity'
      live.createdAt = Math.min(live.createdAt, frame.time)
      return
    }
    state.running = false
    live.state = frame.outcome.kind === 'abandoned' ? 'interrupted' : 'complete'
  }

  private waitForPermissionPreset(
    sessionId: string,
    preset: string,
  ): { promise: Promise<PermissionSelection>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let resolvePromise!: (selection: PermissionSelection) => void
    let rejectPromise!: (reason: Error) => void
    const cleanup = (): void => {
      this.listeners.delete(listener)
      if (timer !== undefined) clearTimeout(timer)
    }
    const settle = (selection: PermissionSelection): void => {
      if (settled) return
      settled = true
      cleanup()
      resolvePromise(structuredClone(selection))
    }
    const listener = (event: RuntimeEvent): void => {
      if (event.type !== 'session-updated' || event.session.id !== sessionId) return
      const selection = event.session.permissionSelection
      if (selection?.currentValue === preset) settle(selection)
    }
    const promise = new Promise<PermissionSelection>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    this.listeners.add(listener)
    timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      rejectPromise(new Error('Harness did not publish the requested permission projection'))
    }, PERMISSION_PROJECTION_TIMEOUT_MS)
    return {
      promise,
      cancel: () => {
        if (settled) return
        settled = true
        cleanup()
      },
    }
  }

  private publish(state: HarnessSessionState): SessionRecord {
    const session = recordOf(state, this.scope)
    const snapshot = structuredClone(session)
    for (const listener of this.listeners) listener({ type: 'session-updated', session: snapshot })
    return session
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Harness runtime is closed')
  }
}
