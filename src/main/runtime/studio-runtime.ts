import type {
  ApprovalDecision,
  ContextStatus,
  ContextCompactResult,
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
} from '../../shared/contracts.js'
import type { AgentRuntime } from './runtime.js'

/** Routes each product session operation to its physically isolated mode runtime. */
export class StudioRuntime {
  readonly mode: AgentRuntime['mode']
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()
  private readonly ownership = new Map<string, SessionScope>()
  private readonly unsubscribers: Array<() => void>

  constructor(
    private readonly daily: AgentRuntime,
    private readonly project: AgentRuntime,
    private readonly dailyWorkingDirectory: string,
  ) {
    if (daily.mode !== project.mode) throw new Error('会话模式运行时配置不一致')
    this.mode = project.mode
    this.unsubscribers = [
      daily.subscribe(event => this.acceptEvent(event)),
      project.subscribe(event => this.acceptEvent(event)),
    ]
  }

  async getHostStatus(): Promise<RuntimeHostStatus> {
    const statuses = await Promise.all([this.daily.getHostStatus(), this.project.getHostStatus()])
    return statuses.find(status => status.phase === 'failed')
      ?? statuses.find(status => status.phase === 'restarting')
      ?? statuses.find(status => status.phase === 'starting')
      ?? statuses[0]
      ?? { phase: this.mode === 'simulation' ? 'simulation' : 'ready' }
  }

  async listSessions(scope: SessionScope): Promise<SessionSummary[]> {
    const sessions = await this.runtime(scope).listSessions()
    for (const session of sessions) this.ownership.set(session.id, scope)
    return sessions
  }

  async getSession(scope: SessionScope, sessionId: string): Promise<SessionRecord | undefined> {
    const session = await this.runtime(scope).getSession(sessionId)
    if (session !== undefined) this.ownership.set(session.id, scope)
    return session
  }

  async createSession(scope: SessionScope, cwd?: string): Promise<SessionRecord> {
    if (scope === 'project' && (cwd === undefined || cwd.trim() === '')) {
      throw new Error('请先选择项目文件夹')
    }
    const session = await this.runtime(scope).createSession(scope === 'daily' ? this.dailyWorkingDirectory : cwd!)
    this.ownership.set(session.id, scope)
    return session
  }

  async deleteSession(scope: SessionScope, sessionId: string): Promise<void> {
    await this.runtime(scope).deleteSession(sessionId)
    this.ownership.delete(sessionId)
  }

  run(scope: SessionScope, sessionId: string, submission: ComposerSubmission): Promise<RunReceipt> {
    return this.runtime(scope).run(sessionId, submission)
  }

  cancel(scope: SessionScope, sessionId: string): Promise<void> {
    return this.runtime(scope).cancel(sessionId)
  }

  selectModel(scope: SessionScope, sessionId: string, selection: ModelSelection): Promise<ModelSelection> {
    return this.runtime(scope).selectModel(sessionId, selection)
  }

  listCommands(sessionId: string): Promise<CommandSummary[]> {
    return this.sessionRuntime(sessionId).then(runtime => runtime.listCommands(sessionId))
  }

  async runCommand(scope: SessionScope, sessionId: string, submission: ComposerCommandSubmission): Promise<void> {
    await this.runtime(scope).runCommand(sessionId, submission)
  }

  uploadFile(scope: SessionScope, sessionId: string, path: string): Promise<ComposerFileAttachment> {
    return this.runtime(scope).uploadFile(sessionId, path)
  }

  listWorkspaceFiles(sessionId: string, query: string): Promise<FileCandidate[]> {
    return this.sessionRuntime(sessionId).then(runtime => runtime.listWorkspaceFiles(sessionId, query))
  }

  getModelConfiguration(): Promise<ModelConfiguration> {
    return this.project.getModelConfiguration()
  }

  updateModelConfiguration(update: ModelConfigurationUpdate): Promise<ModelConfiguration> {
    return this.project.updateModelConfiguration(update)
  }

  discoverModels(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResult> {
    return this.project.discoverModels(request)
  }

  testModel(request: ModelTestRequest): Promise<ModelTestResult> {
    return this.project.testModel(request)
  }

  async listSkills(sessionId: string): Promise<SkillEntry[]> {
    return (await this.sessionRuntime(sessionId)).listSkills(sessionId)
  }

  async importSkill(sessionId: string, sourcePath: string): Promise<SkillEntry> {
    return (await this.sessionRuntime(sessionId)).importSkill(sessionId, sourcePath)
  }

  async setSkillEnabled(sessionId: string, name: string, enabled: boolean): Promise<SkillEntry[]> {
    return (await this.sessionRuntime(sessionId)).setSkillEnabled(sessionId, name, enabled)
  }

  async listPendingInteractions(): Promise<PendingInteraction[]> {
    const [daily, project] = await Promise.all([
      this.daily.listPendingInteractions(),
      this.project.listPendingInteractions(),
    ])
    return [...daily, ...project]
  }

  async getPermissionSelection(sessionId: string): Promise<PermissionSelection | undefined> {
    return (await this.sessionRuntime(sessionId)).getPermissionSelection(sessionId)
  }

  async selectPermissionPreset(sessionId: string, preset: string): Promise<PermissionSelection> {
    return (await this.sessionRuntime(sessionId)).selectPermissionPreset(sessionId, preset)
  }

  async answerApproval(interactionId: string, decision: ApprovalDecision): Promise<void> {
    const runtime = await this.interactionRuntime(interactionId)
    return runtime.answerApproval(interactionId, decision)
  }

  async answerQuestions(interactionId: string, answers: QuestionAnswer[]): Promise<void> {
    const runtime = await this.interactionRuntime(interactionId)
    return runtime.answerQuestions(interactionId, answers)
  }

  async cancelInteraction(interactionId: string): Promise<void> {
    const runtime = await this.interactionRuntime(interactionId, false)
    return runtime?.cancelInteraction(interactionId)
  }

  async getContextStatus(sessionId: string): Promise<ContextStatus> {
    return (await this.sessionRuntime(sessionId)).getContextStatus(sessionId)
  }

  async compactContext(sessionId: string): Promise<ContextCompactResult> {
    return (await this.sessionRuntime(sessionId)).compactContext(sessionId)
  }

  listScheduledTasks(): Promise<ScheduledTask[]> { return this.project.listScheduledTasks() }
  createScheduledTask(input: ScheduledTaskInput): Promise<ScheduledTask> { return this.project.createScheduledTask(input) }
  updateScheduledTask(input: ScheduledTaskUpdate): Promise<ScheduledTask> { return this.project.updateScheduledTask(input) }
  removeScheduledTask(id: string): Promise<void> { return this.project.removeScheduledTask(id) }
  setScheduledTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTask> { return this.project.setScheduledTaskEnabled(id, enabled) }
  runScheduledTaskNow(id: string): Promise<ScheduledTaskRun> { return this.project.runScheduledTaskNow(id) }
  cancelScheduledTaskRun(id: string): Promise<void> { return this.project.cancelScheduledTaskRun(id) }
  listScheduledTaskRuns(taskId: string, limit?: number): Promise<ScheduledTaskRun[]> { return this.project.listScheduledTaskRuns(taskId, limit) }

  setInteractionAnswererAvailable(available: boolean): void {
    this.daily.setInteractionAnswererAvailable(available)
    this.project.setInteractionAnswererAvailable(available)
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispose(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.listeners.clear()
    await Promise.allSettled([this.daily.dispose(), this.project.dispose()])
  }

  private runtime(scope: SessionScope): AgentRuntime {
    return scope === 'daily' ? this.daily : this.project
  }

  private async sessionRuntime(sessionId: string): Promise<AgentRuntime> {
    const known = this.ownership.get(sessionId)
    if (known !== undefined) return this.runtime(known)
    const [daily, project] = await Promise.all([
      this.daily.getSession(sessionId),
      this.project.getSession(sessionId),
    ])
    if (daily !== undefined) {
      this.ownership.set(sessionId, 'daily')
      return this.daily
    }
    if (project !== undefined) {
      this.ownership.set(sessionId, 'project')
      return this.project
    }
    throw new Error('找不到对应会话')
  }

  private async interactionRuntime(interactionId: string, required?: true): Promise<AgentRuntime>
  private async interactionRuntime(interactionId: string, required: false): Promise<AgentRuntime | undefined>
  private async interactionRuntime(interactionId: string, required = true): Promise<AgentRuntime | undefined> {
    const [daily, project] = await Promise.all([
      this.daily.listPendingInteractions(),
      this.project.listPendingInteractions(),
    ])
    if (daily.some(item => item.id === interactionId)) return this.daily
    if (project.some(item => item.id === interactionId)) return this.project
    if (required) throw new Error('待处理请求不存在或已经结束')
    return undefined
  }

  private acceptEvent(event: RuntimeEvent): void {
    if (event.type === 'host-status') {
      void this.getHostStatus().then(status => this.publish({ type: 'host-status', status }))
      return
    }
    if (event.type === 'session-updated') this.ownership.set(event.session.id, event.session.scope)
    this.publish(event)
  }

  private publish(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
