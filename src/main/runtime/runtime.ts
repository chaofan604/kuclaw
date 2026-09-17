import type {
  ApprovalDecision,
  ContextStatus,
  ContextCompactResult,
  ModelConfiguration,
  ModelConfigurationUpdate,
  ModelDiscoveryRequest,
  ModelDiscoveryResult,
  ModelTestRequest,
  ModelTestResult,
  ModelSelection,
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
  ComposerImageUpload,
  ComposerSubmission,
  ToolCard,
} from '../../shared/contracts.js'

export interface AgentRuntime {
  readonly mode: 'simulation' | 'harness'
  getHostStatus(): Promise<RuntimeHostStatus>
  listSessions(): Promise<SessionSummary[]>
  getSession(sessionId: string): Promise<SessionRecord | undefined>
  createSession(cwd: string): Promise<SessionRecord>
  deleteSession(sessionId: string): Promise<void>
  run(sessionId: string, submission: ComposerSubmission): Promise<RunReceipt>
  cancel(sessionId: string): Promise<void>
  selectModel(sessionId: string, selection: ModelSelection): Promise<ModelSelection>
  listCommands(sessionId: string): Promise<CommandSummary[]>
  runCommand(sessionId: string, submission: ComposerCommandSubmission): Promise<void>
  uploadFile(sessionId: string, path: string): Promise<ComposerFileAttachment>
  uploadImage(sessionId: string, image: ComposerImageUpload): Promise<ComposerFileAttachment>
  listWorkspaceFiles(sessionId: string, query: string): Promise<FileCandidate[]>
  getModelConfiguration(): Promise<ModelConfiguration>
  updateModelConfiguration(update: ModelConfigurationUpdate): Promise<ModelConfiguration>
  discoverModels(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResult>
  testModel(request: ModelTestRequest): Promise<ModelTestResult>
  listSkills(sessionId: string): Promise<SkillEntry[]>
  importSkill(sessionId: string, sourcePath: string): Promise<SkillEntry>
  setSkillEnabled(sessionId: string, name: string, enabled: boolean): Promise<SkillEntry[]>
  listPendingInteractions(): Promise<PendingInteraction[]>
  getPermissionSelection(sessionId: string): Promise<PermissionSelection | undefined>
  selectPermissionPreset(sessionId: string, preset: string): Promise<PermissionSelection>
  setInteractionAnswererAvailable(available: boolean): void
  answerApproval(interactionId: string, decision: ApprovalDecision): Promise<void>
  answerQuestions(interactionId: string, answers: QuestionAnswer[]): Promise<void>
  cancelInteraction(interactionId: string): Promise<void>
  getContextStatus(sessionId: string): Promise<ContextStatus>
  compactContext(sessionId: string): Promise<ContextCompactResult>
  listScheduledTasks(): Promise<ScheduledTask[]>
  createScheduledTask(input: ScheduledTaskInput): Promise<ScheduledTask>
  updateScheduledTask(input: ScheduledTaskUpdate): Promise<ScheduledTask>
  removeScheduledTask(id: string): Promise<void>
  setScheduledTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTask>
  runScheduledTaskNow(id: string): Promise<ScheduledTaskRun>
  cancelScheduledTaskRun(id: string): Promise<void>
  listScheduledTaskRuns(taskId: string, limit?: number): Promise<ScheduledTaskRun[]>
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  dispose(): Promise<void>
}
