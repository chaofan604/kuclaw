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
  SessionSummary,
  SkillEntry,
  FileCandidate,
  CommandSummary,
  ComposerCommandSubmission,
  ComposerFileAttachment,
  ComposerSubmission,
} from '../../shared/contracts.js'
import type { AgentRuntime } from './runtime.js'

export type HarnessRuntimeFactory = (onFailure: (error: Error) => void) => Promise<AgentRuntime>

/** Owns one replaceable Harness runtime and keeps Electron IPC stable across Host restarts. */
export class HarnessRuntimeSupervisor implements AgentRuntime {
  readonly mode = 'harness' as const
  private inner: AgentRuntime | undefined
  private innerUnsubscribe: (() => void) | undefined
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()
  private status: RuntimeHostStatus = { phase: 'starting' }
  private generation = 0
  private restarting: Promise<void> | undefined
  private closed = false
  private answererAvailable = false

  private constructor(private readonly factory: HarnessRuntimeFactory) {}

  static async create(factory: HarnessRuntimeFactory): Promise<HarnessRuntimeSupervisor> {
    const supervisor = new HarnessRuntimeSupervisor(factory)
    await supervisor.replace('starting')
    return supervisor
  }

  getHostStatus(): Promise<RuntimeHostStatus> {
    return Promise.resolve(structuredClone(this.status))
  }

  restart(reason = '正在重新启动 Harness Host'): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Harness runtime supervisor is closed'))
    if (this.restarting !== undefined) return this.restarting
    const task = this.replace('restarting', reason).finally(() => {
      if (this.restarting === task) this.restarting = undefined
    })
    this.restarting = task
    return task
  }

  listSessions(): Promise<SessionSummary[]> { return this.withRuntime(runtime => runtime.listSessions()) }
  getSession(id: string): Promise<SessionRecord | undefined> { return this.withRuntime(runtime => runtime.getSession(id)) }
  createSession(cwd: string): Promise<SessionRecord> { return this.withRuntime(runtime => runtime.createSession(cwd)) }
  deleteSession(id: string): Promise<void> { return this.withRuntime(runtime => runtime.deleteSession(id)) }
  run(id: string, submission: ComposerSubmission): Promise<RunReceipt> {
    return this.withRuntime(runtime => runtime.run(id, submission))
  }
  cancel(id: string): Promise<void> { return this.withRuntime(runtime => runtime.cancel(id)) }
  selectModel(id: string, value: ModelSelection): Promise<ModelSelection> {
    return this.withRuntime(runtime => runtime.selectModel(id, value))
  }
  listCommands(id: string): Promise<CommandSummary[]> {
    return this.withRuntime(runtime => runtime.listCommands(id))
  }
  runCommand(id: string, submission: ComposerCommandSubmission): Promise<void> {
    return this.withRuntime(runtime => runtime.runCommand(id, submission))
  }
  uploadFile(id: string, path: string): Promise<ComposerFileAttachment> {
    return this.withRuntime(runtime => runtime.uploadFile(id, path))
  }
  listWorkspaceFiles(id: string, query: string): Promise<FileCandidate[]> {
    return this.withRuntime(runtime => runtime.listWorkspaceFiles(id, query))
  }
  getModelConfiguration(): Promise<ModelConfiguration> {
    return this.withRuntime(runtime => runtime.getModelConfiguration())
  }
  updateModelConfiguration(value: ModelConfigurationUpdate): Promise<ModelConfiguration> {
    return this.withRuntime(runtime => runtime.updateModelConfiguration(value))
  }
  discoverModels(value: ModelDiscoveryRequest): Promise<ModelDiscoveryResult> {
    return this.withRuntime(runtime => runtime.discoverModels(value))
  }
  testModel(value: ModelTestRequest): Promise<ModelTestResult> {
    return this.withRuntime(runtime => runtime.testModel(value))
  }
  listSkills(id: string): Promise<SkillEntry[]> { return this.withRuntime(runtime => runtime.listSkills(id)) }
  importSkill(id: string, path: string): Promise<SkillEntry> {
    return this.withRuntime(runtime => runtime.importSkill(id, path))
  }
  setSkillEnabled(id: string, name: string, enabled: boolean): Promise<SkillEntry[]> {
    return this.withRuntime(runtime => runtime.setSkillEnabled(id, name, enabled))
  }
  listPendingInteractions(): Promise<PendingInteraction[]> {
    return this.withRuntime(runtime => runtime.listPendingInteractions())
  }
  getPermissionSelection(id: string): Promise<PermissionSelection | undefined> {
    return this.withRuntime(runtime => runtime.getPermissionSelection(id))
  }
  selectPermissionPreset(id: string, preset: string): Promise<PermissionSelection> {
    return this.withRuntime(runtime => runtime.selectPermissionPreset(id, preset))
  }
  answerApproval(id: string, decision: ApprovalDecision): Promise<void> {
    return this.withRuntime(runtime => runtime.answerApproval(id, decision))
  }
  answerQuestions(id: string, answers: QuestionAnswer[]): Promise<void> {
    return this.withRuntime(runtime => runtime.answerQuestions(id, answers))
  }
  cancelInteraction(id: string): Promise<void> {
    return this.withRuntime(runtime => runtime.cancelInteraction(id))
  }
  getContextStatus(id: string): Promise<ContextStatus> {
    return this.withRuntime(runtime => runtime.getContextStatus(id))
  }
  compactContext(id: string): Promise<ContextCompactResult> {
    return this.withRuntime(runtime => runtime.compactContext(id))
  }
  listScheduledTasks(): Promise<ScheduledTask[]> { return this.withRuntime(runtime => runtime.listScheduledTasks()) }
  createScheduledTask(value: ScheduledTaskInput): Promise<ScheduledTask> { return this.withRuntime(runtime => runtime.createScheduledTask(value)) }
  updateScheduledTask(value: ScheduledTaskUpdate): Promise<ScheduledTask> { return this.withRuntime(runtime => runtime.updateScheduledTask(value)) }
  removeScheduledTask(id: string): Promise<void> { return this.withRuntime(runtime => runtime.removeScheduledTask(id)) }
  setScheduledTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTask> { return this.withRuntime(runtime => runtime.setScheduledTaskEnabled(id, enabled)) }
  runScheduledTaskNow(id: string): Promise<ScheduledTaskRun> { return this.withRuntime(runtime => runtime.runScheduledTaskNow(id)) }
  cancelScheduledTaskRun(id: string): Promise<void> { return this.withRuntime(runtime => runtime.cancelScheduledTaskRun(id)) }
  listScheduledTaskRuns(taskId: string, limit?: number): Promise<ScheduledTaskRun[]> { return this.withRuntime(runtime => runtime.listScheduledTaskRuns(taskId, limit)) }

  setInteractionAnswererAvailable(available: boolean): void {
    this.answererAvailable = available
    this.inner?.setInteractionAnswererAvailable(available)
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.generation += 1
    this.innerUnsubscribe?.()
    this.innerUnsubscribe = undefined
    const current = this.inner
    this.inner = undefined
    await current?.dispose()
  }

  private async withRuntime<T>(operation: (runtime: AgentRuntime) => Promise<T>): Promise<T> {
    await this.restarting
    if (this.closed) throw new Error('Harness runtime supervisor is closed')
    if (this.inner === undefined) throw new Error(this.status.message ?? 'Harness Host 不可用')
    return operation(this.inner)
  }

  private async replace(phase: 'starting' | 'restarting', message?: string): Promise<void> {
    this.setStatus({ phase, ...(message === undefined ? {} : { message }) })
    const generation = ++this.generation
    this.innerUnsubscribe?.()
    this.innerUnsubscribe = undefined
    const previous = this.inner
    this.inner = undefined
    await previous?.dispose()
    try {
      const next = await this.factory(error => this.handleFailure(generation, error))
      if (this.closed || generation !== this.generation) {
        await next.dispose()
        return
      }
      this.inner = next
      next.setInteractionAnswererAvailable(this.answererAvailable)
      this.innerUnsubscribe = next.subscribe(event => this.emit(event))
      this.setStatus({ phase: 'ready' })
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      if (generation === this.generation) this.setStatus({ phase: 'failed', message: error.message })
      throw error
    }
  }

  private handleFailure(generation: number, error: Error): void {
    if (this.closed || generation !== this.generation) return
    void this.restart(error.message).catch(() => undefined)
  }

  private setStatus(status: RuntimeHostStatus): void {
    this.status = status
    this.emit({ type: 'host-status', status: structuredClone(status) })
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
