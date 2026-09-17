import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import type {
  ApprovalDecision,
  ContextStatus,
  ContextCompactResult,
  ChatMessage,
  ModelConfiguration,
  ModelConfigurationUpdate,
  ModelDiscoveryRequest,
  ModelDiscoveryResult,
  ModelSelection,
  ModelTestRequest,
  ModelTestResult,
  PendingInteraction,
  PermissionSelection,
  QuestionAnswer,
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
  ComposerSubmission,
  ToolCard,
} from '../../shared/contracts.js'
import type { AgentRuntime } from './runtime.js'
import { SessionStore } from './session-store.js'
import type { LocalSkillLibrary } from './skill-library.js'
import { nextCronOccurrence, validateCronSchedule } from './cron-schedule.js'

const RESPONSE_PARTS = [
  '## 已完成\n\n',
  '我先检查了工作区入口与配置，确认改动应该落在运行时适配层。\n\n',
  '### 当前结果\n\n',
  '- 界面、会话与实时事件已经按真实运行时接口组织。\n',
  '- 工具执行过程会保留在当前任务中，并在完成后折叠。\n',
  '- 最终回答支持列表、代码块、表格和链接等 Markdown 内容。\n\n',
  '下一步可以继续接入真实模型、文件工具和审批。',
]

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

function titleFromPrompt(prompt: string): string {
  const clean = prompt.replaceAll(/\s+/g, ' ').trim()
  return clean.length > 22 ? `${clean.slice(0, 22)}…` : clean
}

function readCard(): ToolCard {
  return {
    id: randomUUID(),
    title: '读取项目入口',
    kind: 'read',
    state: 'pending',
    detail: '检查应用结构与运行时边界',
    path: 'src/main.ts',
    createdAt: Date.now(),
  }
}

function diffCard(): ToolCard {
  return {
    id: randomUUID(),
    title: '预演运行时适配',
    kind: 'diff',
    state: 'complete',
    detail: '模拟器不会修改所选工作区',
    path: 'src/runtime/adapter.ts',
    createdAt: Date.now(),
    diff: [
      { kind: 'context', text: 'export class RuntimeAdapter {' },
      { kind: 'removed', text: '  mode = "mock"' },
      { kind: 'added', text: '  mode = "harness"' },
      { kind: 'context', text: '}' },
    ],
  }
}

export class MockAgentRuntime implements AgentRuntime {
  readonly mode = 'simulation' as const
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()
  private readonly runs = new Map<string, AbortController>()
  private readonly scheduledTasks = new Map<string, ScheduledTask>()
  private readonly scheduledTaskRuns = new Map<string, ScheduledTaskRun[]>()
  private modelConfiguration: ModelConfiguration = {
    available: true,
    writable: true,
    credentialConfigured: false,
    credentialWritable: true,
    baseURL: 'https://api.deepseek.com',
    maxTokens: 256_000,
    defaultSelection: {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'high',
    },
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-flash',
          name: 'DeepSeek-V41-Flash',
          reasoningEfforts: [
            { id: 'off', name: '关闭' },
            { id: 'low', name: '低' },
            { id: 'high', name: '高' },
            { id: 'max', name: '最高' },
          ],
          defaultReasoningEffort: 'high',
        },
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek-V4-Pro',
          description: '适合复杂、质量优先的编程任务。',
          reasoningEfforts: [
            { id: 'off', name: '关闭' },
            { id: 'low', name: '低' },
            { id: 'high', name: '高' },
            { id: 'max', name: '最高' },
          ],
          defaultReasoningEffort: 'high',
        },
      ],
    }],
    profiles: [],
    failures: [],
  }

  constructor(
    private readonly store: SessionStore,
    private readonly skillLibrary?: LocalSkillLibrary,
    private readonly scope: SessionScope = 'project',
  ) {}

  getHostStatus(): Promise<RuntimeHostStatus> {
    return Promise.resolve({ phase: 'simulation' })
  }

  listSessions(): Promise<SessionSummary[]> {
    return this.store.list()
  }

  getSession(sessionId: string): Promise<SessionRecord | undefined> {
    return this.store.get(sessionId)
  }

  async createSession(cwd: string): Promise<SessionRecord> {
    const now = Date.now()
    const session: SessionRecord = {
      id: `session-${randomUUID().replaceAll('-', '')}`,
      scope: this.scope,
      title: this.scope === 'daily' ? '新对话' : `新任务 · ${basename(cwd)}`,
      cwd,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      messages: [],
      tools: [],
      jobs: [],
    }
    await this.update(session)
    return session
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.store.get(sessionId)
    if (session?.status === 'running') throw new Error('请先停止当前会话，再删除。')
    await this.store.delete(sessionId)
  }

  async run(sessionId: string, submission: ComposerSubmission): Promise<RunReceipt> {
    const referenced = submission.references.map(reference => reference.serializedText)
    const messageText = [...referenced, submission.text.trim()].filter(part => part !== '').join(' ')
    if (messageText === '' && submission.attachments.length === 0) throw new Error('任务内容不能为空')
    if (this.runs.has(sessionId)) throw new Error('这个会话正在运行')
    const session = await this.requireSession(sessionId)
    const user: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      text: messageText,
      createdAt: Date.now(),
      state: 'complete',
      ...(submission.attachments.length === 0 ? {} : {
        attachments: submission.attachments.map(attachment => ({
          id: attachment.receiptId,
          name: attachment.name,
          bytes: attachment.bytes,
        })),
      }),
    }
    const assistant: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      createdAt: Date.now(),
      state: 'streaming',
    }
    const controller = new AbortController()
    this.runs.set(sessionId, controller)
    const titleText = messageText || submission.attachments.map(attachment => attachment.name).join(' ')
    session.title = session.messages.length === 0 ? titleFromPrompt(titleText) : session.title
    session.messages.push(user, assistant)
    session.tools = []
    session.status = 'running'
    try {
      await this.update(session)
    } catch (error) {
      this.runs.delete(sessionId)
      throw error
    }
    void this.execute(session, assistant, controller)
    return { messageId: user.id }
  }

  async cancel(sessionId: string): Promise<void> {
    this.runs.get(sessionId)?.abort(new Error('用户取消了运行'))
  }

  listScheduledTasks(): Promise<ScheduledTask[]> {
    return Promise.resolve([...this.scheduledTasks.values()].sort((left, right) => left.nextRunAt - right.nextRunAt).map(value => structuredClone(value)))
  }

  async createScheduledTask(input: ScheduledTaskInput): Promise<ScheduledTask> {
    validateCronSchedule(input.cron, input.timeZone)
    const now = Date.now()
    const task: ScheduledTask = {
      id: randomUUID(), name: input.name.trim(), workspacePath: input.workspacePath.trim(), cron: input.cron.trim(),
      timeZone: input.timeZone, prompt: input.prompt.trim(), model: structuredClone(input.model), preset: input.preset?.trim() ?? '',
      enabled: input.enabled ?? true, concurrency: input.concurrency ?? 'skip', missedRunPolicy: input.missedRunPolicy ?? 'skip',
      nextRunAt: nextCronOccurrence(input.cron, input.timeZone, now), createdAt: now, updatedAt: now,
    }
    this.scheduledTasks.set(task.id, task)
    return structuredClone(task)
  }

  async updateScheduledTask(input: ScheduledTaskUpdate): Promise<ScheduledTask> {
    const current = this.scheduledTasks.get(input.id)
    if (current === undefined) throw new Error('scheduled task not found')
    const merged = { ...current, ...input, model: input.model ?? current.model }
    validateCronSchedule(merged.cron, merged.timeZone)
    const task: ScheduledTask = { ...merged, nextRunAt: nextCronOccurrence(merged.cron, merged.timeZone, Date.now()), updatedAt: Date.now() }
    this.scheduledTasks.set(task.id, task)
    return structuredClone(task)
  }

  removeScheduledTask(id: string): Promise<void> {
    this.scheduledTasks.delete(id)
    this.scheduledTaskRuns.delete(id)
    return Promise.resolve()
  }

  setScheduledTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    return this.updateScheduledTask({ id, enabled })
  }

  async runScheduledTaskNow(id: string): Promise<ScheduledTaskRun> {
    const task = this.scheduledTasks.get(id)
    if (task === undefined) throw new Error('scheduled task not found')
    const run: ScheduledTaskRun = { id: randomUUID(), taskId: id, scheduledAt: Date.now(), status: 'pending' }
    this.scheduledTaskRuns.set(id, [run, ...this.scheduledTaskRuns.get(id) ?? []])
    try {
      const session = await this.createSession(task.workspacePath)
      await this.selectModel(session.id, task.model)
      run.sessionId = session.id
      run.status = 'running'
      run.startedAt = Date.now()
      await this.run(session.id, { text: task.prompt, references: [], attachments: [] })
      setTimeout(() => {
        if (run.status !== 'running') return
        run.status = 'succeeded'
        run.finishedAt = Date.now()
      }, 3_000)
    } catch (error) {
      run.status = 'failed'
      run.finishedAt = Date.now()
      run.errorMessage = error instanceof Error ? error.message : String(error)
    }
    return structuredClone(run)
  }

  cancelScheduledTaskRun(id: string): Promise<void> {
    for (const runs of this.scheduledTaskRuns.values()) {
      const run = runs.find(value => value.id === id)
      if (run === undefined) continue
      run.status = 'cancelled'
      run.finishedAt = Date.now()
      if (run.sessionId !== undefined) return this.cancel(run.sessionId)
    }
    return Promise.resolve()
  }

  listScheduledTaskRuns(taskId: string, limit = 50): Promise<ScheduledTaskRun[]> {
    return Promise.resolve((this.scheduledTaskRuns.get(taskId) ?? []).slice(0, limit).map(value => structuredClone(value)))
  }

  async listCommands(_sessionId: string): Promise<CommandSummary[]> {
    return [
      { name: 'compact', description: '压缩当前对话的上下文' },
    ]
  }

  async runCommand(_sessionId: string, submission: ComposerCommandSubmission): Promise<void> {
    if (submission.command !== 'compact') throw new Error(`模拟运行时不支持命令 ${submission.command}`)
  }

  async uploadFile(_sessionId: string, path: string): Promise<ComposerFileAttachment> {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('请选择一个文件')
    return {
      receiptId: `simulation-${randomUUID()}`,
      name: basename(path),
      bytes: info.size,
    }
  }

  /** Bounded workspace scan that mirrors the Harness file-reference candidates. */
  async listWorkspaceFiles(sessionId: string, query: string): Promise<FileCandidate[]> {
    const session = await this.store.get(sessionId)
    if (session === undefined) throw new Error(`找不到会话 ${sessionId}`)
    const root = session.cwd
    const segments = query.split('/').filter(segment => segment !== '')
    const queryEndsAtDirectory = query.endsWith('/')
    const base = queryEndsAtDirectory ? segments : segments.slice(0, -1)
    const stem = queryEndsAtDirectory ? '' : (segments.at(-1) ?? '')
    let directory = root
    for (const segment of base) {
      directory = `${directory}/${segment}`
    }
    const stemLower = stem.toLowerCase()
    const candidates: FileCandidate[] = []
    const visit = async (current: string, depth: number): Promise<void> => {
      if (candidates.length >= 40 || depth > 3) return
      let entries
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (candidates.length >= 40) return
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const matches = entry.name.toLowerCase().includes(stemLower)
        const path = `${current}/${entry.name}`.slice(root.length + 1)
        if (entry.isDirectory()) {
          if (matches || stemLower === '') {
            candidates.push({ path: `${path}/`, kind: 'directory' })
          }
          await visit(`${current}/${entry.name}`, depth + 1)
        } else if (matches) {
          candidates.push({ path, kind: 'file' })
        }
      }
    }
    await visit(directory, 0)
    return candidates
  }

  async selectModel(_sessionId: string, selection: ModelSelection): Promise<ModelSelection> {
    this.modelConfiguration.defaultSelection = structuredClone(selection)
    return structuredClone(selection)
  }

  getModelConfiguration(): Promise<ModelConfiguration> {
    return Promise.resolve(structuredClone(this.modelConfiguration))
  }

  updateModelConfiguration(update: ModelConfigurationUpdate): Promise<ModelConfiguration> {
    if (update.apiKey !== undefined) this.modelConfiguration.credentialConfigured = update.apiKey.trim() !== ''
    if (update.clearApiKey === true) this.modelConfiguration.credentialConfigured = false
    if (update.baseURL !== undefined) this.modelConfiguration.baseURL = update.baseURL
    if (update.maxTokens !== undefined) this.modelConfiguration.maxTokens = update.maxTokens
    if (update.defaultSelection !== undefined) {
      this.modelConfiguration.defaultSelection = structuredClone(update.defaultSelection)
    }
    if (update.upsertProfile !== undefined) {
      const input = update.upsertProfile
      const profile = {
        id: input.id,
        displayName: input.displayName,
        protocol: input.protocol,
        baseURL: input.baseURL,
        credentialConfigured: input.clearApiKey === true
          ? false
          : input.apiKey?.trim() !== ''
            || (this.modelConfiguration.profiles.find(item => item.id === input.id)?.credentialConfigured ?? false),
        credentialWritable: true,
        models: structuredClone(input.models),
      }
      this.modelConfiguration.profiles = [
        ...this.modelConfiguration.profiles.filter(item => item.id !== input.id),
        profile,
      ]
      this.modelConfiguration.groups = [
        ...this.modelConfiguration.groups.filter(group => group.id !== input.id),
        {
          id: input.id,
          name: input.displayName,
          models: input.models.map(model => ({
            id: model.id,
            name: model.name,
            reasoningEfforts: [],
          })),
        },
      ]
    }
    if (update.removeProfileId !== undefined) {
      this.modelConfiguration.profiles = this.modelConfiguration.profiles
        .filter(item => item.id !== update.removeProfileId)
      this.modelConfiguration.groups = this.modelConfiguration.groups
        .filter(group => group.id !== update.removeProfileId)
    }
    return this.getModelConfiguration()
  }

  discoverModels(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResult> {
    const prefix = request.protocol === 'anthropic-messages' ? 'claude' : 'model'
    return Promise.resolve({
      models: [{
        id: `${prefix}-example`,
        name: `${prefix}-example`,
        contextWindow: 262_144,
        maxTokens: 32_768,
      }],
    })
  }

  testModel(request: ModelTestRequest): Promise<ModelTestResult> {
    const profile = this.modelConfiguration.profiles.find(item => item.id === request.providerId)
    if (profile === undefined || !profile.models.some(model => model.id === request.modelId)) {
      return Promise.reject(new Error('要测试的模型不存在'))
    }
    return Promise.resolve({ latencyMs: 120 })
  }

  async listSkills(_sessionId: string): Promise<SkillEntry[]> {
    const managed = await this.skillLibrary?.list() ?? []
    return [
      {
        name: 'review-change',
        description: '检查当前改动中的缺陷、风险与测试缺口。',
        modelInvocable: true,
        userInvocable: true,
        enabled: true,
        managed: false,
        source: 'runtime',
      },
      ...managed,
    ]
  }

  async importSkill(_sessionId: string, sourcePath: string): Promise<SkillEntry> {
    if (this.skillLibrary === undefined) throw new Error('当前运行时没有可写 Skill 目录')
    return this.skillLibrary.import(sourcePath)
  }

  async setSkillEnabled(sessionId: string, name: string, enabled: boolean): Promise<SkillEntry[]> {
    if (this.skillLibrary === undefined) throw new Error('当前运行时没有可写 Skill 目录')
    await this.skillLibrary.setEnabled(name, enabled)
    return this.listSkills(sessionId)
  }

  listPendingInteractions(): Promise<PendingInteraction[]> {
    return Promise.resolve([])
  }

  getPermissionSelection(_sessionId: string): Promise<PermissionSelection> {
    return Promise.resolve({
      options: [
        { value: 'workspace-write', name: '工作区写入' },
        { value: 'danger-full-access', name: '完全访问' },
      ],
      currentValue: 'workspace-write',
    })
  }

  selectPermissionPreset(_sessionId: string, preset: string): Promise<PermissionSelection> {
    if (preset !== 'workspace-write' && preset !== 'danger-full-access') {
      return Promise.reject(new Error('未知权限预设'))
    }
    return Promise.resolve({
      options: [
        { value: 'workspace-write', name: '工作区写入' },
        { value: 'danger-full-access', name: '完全访问' },
      ],
      currentValue: preset,
    })
  }

  setInteractionAnswererAvailable(_available: boolean): void {}

  answerApproval(_interactionId: string, _decision: ApprovalDecision): Promise<void> {
    return Promise.reject(new Error('模拟运行时没有待处理的审批'))
  }

  answerQuestions(_interactionId: string, _answers: QuestionAnswer[]): Promise<void> {
    return Promise.reject(new Error('模拟运行时没有待处理的问题'))
  }

  cancelInteraction(_interactionId: string): Promise<void> {
    return Promise.resolve()
  }

  getContextStatus(_sessionId: string): Promise<ContextStatus> {
    return Promise.resolve({
      systemTokens: 0,
      toolsTokens: 0,
      messageTokens: 0,
      usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      compactions: [],
    })
  }

  compactContext(_sessionId: string): Promise<ContextCompactResult> {
    return Promise.resolve({ status: 'unchanged' })
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispose(): Promise<void> {
    for (const controller of this.runs.values()) controller.abort(new Error('应用正在退出'))
    this.runs.clear()
    await this.store.flush()
  }

  private async execute(session: SessionRecord, assistant: ChatMessage, controller: AbortController): Promise<void> {
    try {
      for (let index = 0; index < RESPONSE_PARTS.length; index += 1) {
        await delay(260, controller.signal)
        if (index === 1) {
          session.tools.push(readCard())
          await this.update(session)
        }
        if (index === 3) {
          const read = session.tools.find(tool => tool.kind === 'read')
          if (read !== undefined) read.state = 'complete'
          await this.update(session)
        }
        if (index === 4) {
          session.tools.push(diffCard())
          await this.update(session)
        }
        assistant.text += RESPONSE_PARTS[index] ?? ''
        await this.update(session)
      }
      assistant.state = 'complete'
      session.status = 'idle'
      await this.update(session)
    } catch {
      assistant.state = 'interrupted'
      assistant.text = assistant.text === '' ? '本次运行已取消。' : `${assistant.text}\n\n本次运行已取消。`
      for (const tool of session.tools) {
        if (tool.state === 'pending') tool.state = 'error'
      }
      session.status = 'idle'
      await this.update(session)
    } finally {
      this.runs.delete(session.id)
    }
  }

  private async requireSession(sessionId: string): Promise<SessionRecord> {
    const session = await this.store.get(sessionId)
    if (session === undefined) throw new Error(`找不到会话 ${sessionId}`)
    return session
  }

  private async update(session: SessionRecord): Promise<void> {
    session.updatedAt = Date.now()
    await this.store.put(session)
    const snapshot = structuredClone(session)
    for (const listener of this.listeners) listener({ type: 'session-updated', session: snapshot })
  }
}
