export type SessionStatus = 'idle' | 'running' | 'error'
export type SessionScope = 'daily' | 'project'
export type MessageState = 'complete' | 'streaming' | 'interrupted' | 'error'
export type ToolState = 'pending' | 'complete' | 'error'

export interface ChatFileAttachment {
  /** Durable Harness attachment identity used to keep repeated filenames distinct. */
  id: string
  /** Sanitized filename recorded with the user message. */
  name: string
  /** Exact uploaded byte length. */
  bytes: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  state: MessageState
  sequence?: number
  /** Assistant text is either progress commentary or the final user-facing answer. */
  presentation?: 'activity' | 'answer'
  /** Generic files attached to this user message. */
  attachments?: ChatFileAttachment[]
}

/** One model reasoning passage shown in its original position in the turn. */
export interface ChatReasoning {
  id: string
  text: string
  createdAt: number
  state: 'complete' | 'streaming'
  sequence?: number
}

export interface DiffLine {
  kind: 'context' | 'added' | 'removed'
  text: string
}

export interface ToolCard {
  id: string
  title: string
  kind: 'read' | 'diff' | 'terminal' | 'search' | 'web' | 'other'
  state: ToolState
  detail: string
  createdAt?: number
  sequence?: number
  path?: string
  output?: string
  diff?: DiffLine[]
  exitCode?: number
  signal?: string
  truncated?: boolean
  total?: number
  url?: string
  statusCode?: number
}

export interface SessionGoalStatus {
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  roundsStarted: number
}

export interface SessionPlanStatus {
  active: boolean
  pending: boolean
}

export interface SessionRecord {
  id: string
  scope: SessionScope
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
  status: SessionStatus
  modelSelection?: ModelSelection
  permissionSelection?: PermissionSelection
  goalStatus?: SessionGoalStatus
  planStatus?: SessionPlanStatus
  messages: ChatMessage[]
  reasoning?: ChatReasoning[]
  tools: ToolCard[]
  jobs: BackgroundTask[]
}

export interface BackgroundTask {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}

export interface SessionSummary {
  id: string
  scope: SessionScope
  title: string
  cwd: string
  updatedAt: number
  status: SessionStatus
  preview: string
}

export interface RunReceipt {
  messageId: string
}

export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface ModelCatalogModel {
  id: string
  name: string
  description?: string
  reasoningEfforts: ModelReasoningEffort[]
  defaultReasoningEffort?: string
}

export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelCatalogModel[]
}

export type ModelProviderProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'

export interface ModelProviderProfileModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
}

export interface ModelProviderProfile {
  id: string
  displayName: string
  protocol: ModelProviderProtocol
  baseURL: string
  credentialConfigured: boolean
  credentialSource?: string
  credentialWritable: boolean
  models: ModelProviderProfileModel[]
}

export interface ModelConfiguration {
  available: boolean
  writable: boolean
  credentialConfigured: boolean
  credentialSource?: string
  credentialWritable: boolean
  baseURL: string
  maxTokens: number
  defaultSelection: ModelSelection
  groups: ModelProviderGroup[]
  profiles: ModelProviderProfile[]
  failures: { id: string; name: string; message: string }[]
}

export interface ModelProviderProfileInput {
  id: string
  displayName: string
  protocol: ModelProviderProtocol
  baseURL: string
  models: ModelProviderProfileModel[]
  apiKey?: string
  clearApiKey?: boolean
}

export interface ModelConfigurationUpdate {
  apiKey?: string
  clearApiKey?: boolean
  baseURL?: string
  maxTokens?: number
  defaultSelection?: ModelSelection
  upsertProfile?: ModelProviderProfileInput
  removeProfileId?: string
}

export interface ModelDiscoveryRequest {
  providerId?: string
  protocol: ModelProviderProtocol
  baseURL: string
  apiKey?: string
}

export interface ModelDiscoveryResult {
  models: ModelProviderProfileModel[]
}

export interface ModelTestRequest {
  providerId: string
  modelId: string
}

export interface ModelTestResult {
  latencyMs: number
}

export type SkillSource = 'project' | 'user' | 'runtime'

export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  path?: string
  modelInvocable: boolean
  userInvocable: boolean
  enabled: boolean
  managed: boolean
  source: SkillSource
}

/** One completion candidate for an `@` file mention inside the session workspace. */
export interface FileCandidate {
  /** Workspace-relative path accepted by prompts and filesystem tools. */
  path: string
  /** Directories keep completion open; files finish the mention. */
  kind: 'file' | 'directory'
}

/** One user-invocable Harness command advertised for slash discovery. */
export interface CommandSummary {
  /** Lowercase command name without the leading slash. */
  name: string
  description: string
}

/** A workspace path selected through the Harness file-reference provider. */
export interface ComposerWorkspaceReference {
  /** Visible workspace-relative path. */
  path: string
  /** Hidden Harness mention syntax sent with the user prompt. */
  serializedText: string
}

/** A Finder file staged in the Harness attachment store for one Session. */
export interface ComposerFileAttachment {
  /** Agent-scoped upload receipt accepted by the next prompt or command. */
  receiptId: string
  /** Sanitized filename returned by the Harness attachment store. */
  name: string
  /** Exact uploaded byte length. */
  bytes: number
}

/** Structured composer value submitted by the Renderer. */
export interface ComposerSubmission {
  /** User-authored text without visual reference or command entities. */
  text: string
  /** Selected workspace references in display order. */
  references: ComposerWorkspaceReference[]
  /** Finder files already staged for this Session. */
  attachments: ComposerFileAttachment[]
}

/** Structured slash-command value submitted by the Renderer. */
export interface ComposerCommandSubmission extends ComposerSubmission {
  /** Command name without the leading slash. */
  command: string
}

export type ApprovalDecision = 'allowed-once' | 'rejected'

export interface ApprovalInteraction {
  id: string
  kind: 'approval'
  sessionId: string
  toolName: string
  callId?: string
  reason?: string
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface QuestionInteraction {
  id: string
  kind: 'questions'
  sessionId: string
  questions: QuestionItem[]
}

export type PendingInteraction = ApprovalInteraction | QuestionInteraction

export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

export interface PermissionOption {
  value: string
  name: string
  description?: string
}

export interface PermissionSelection {
  options: PermissionOption[]
  currentValue: string
}

export type RuntimeHostPhase = 'simulation' | 'starting' | 'ready' | 'restarting' | 'failed'

export interface RuntimeHostStatus {
  phase: RuntimeHostPhase
  message?: string
}

export interface TokenUsageStatus {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface CompactionRecord {
  id: string
  status: 'running' | 'complete' | 'error'
  startedAt: number
  completedAt?: number
  shadowedTokenCount?: number
  provider?: string
  model?: string
  error?: string
}

export interface ContextStatus {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
  systemTokens: number
  toolsTokens: number
  messageTokens: number
  usage: TokenUsageStatus
  compactions: CompactionRecord[]
}

export interface ContextCompactResult {
  status: 'complete' | 'unchanged'
}

export type WorkspaceChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

/** One current Git worktree change for the selected Session project. */
export interface WorkspaceChange {
  path: string
  kind: WorkspaceChangeKind
  staged: boolean
  additions: number
  deletions: number
}

/** Current Git state for the selected Session project. */
export interface WorkspaceChanges {
  isRepository: boolean
  branch?: string
  additions: number
  deletions: number
  files: WorkspaceChange[]
}

/** One directory entry beneath the selected Session project. */
export interface WorkspaceTreeEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
}

/** Text content returned for a project file selected by the user. */
export interface WorkspaceFileContent {
  path: string
  content: string
  bytes: number
  truncated: boolean
  binary: boolean
}

/** Unified Git patch for one changed project file. */
export interface WorkspaceFileDiff {
  path: string
  patch: string
  kind: WorkspaceChangeKind
  additions: number
  deletions: number
}

export type McpTransport = 'stdio' | 'streamable-http'
export type McpConnectionStatus = 'configured' | 'restarting' | 'ready' | 'error'

export interface McpServerSummary {
  id: string
  serverName: string
  transport: McpTransport
  enabled: boolean
  command?: string
  args?: string[]
  cwd?: string
  envKeys?: string[]
  url?: string
  headerKeys?: string[]
  toolCallTimeoutMs: number
  status: McpConnectionStatus
  toolCount?: number
  error?: string
}

export interface McpServerInput {
  id: string
  serverName: string
  transport: McpTransport
  enabled: boolean
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
}

export interface MemoryEntry {
  id: string
  content: string
  source: string
  createdAt: number
  updatedAt: number
}

export type ScheduledTaskConcurrency = 'skip' | 'queue'
export type ScheduledTaskMissedRunPolicy = 'skip' | 'run-once'
export type ScheduledTaskRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'skipped'

export interface ScheduledTask {
  id: string
  name: string
  workspacePath: string
  cron: string
  timeZone: string
  prompt: string
  model: ModelSelection
  preset: string
  enabled: boolean
  concurrency: ScheduledTaskConcurrency
  missedRunPolicy: ScheduledTaskMissedRunPolicy
  nextRunAt: number
  createdAt: number
  updatedAt: number
}

export interface ScheduledTaskInput {
  name: string
  workspacePath: string
  cron: string
  timeZone: string
  prompt: string
  model: ModelSelection
  preset?: string
  enabled?: boolean
  concurrency?: ScheduledTaskConcurrency
  missedRunPolicy?: ScheduledTaskMissedRunPolicy
}

export interface ScheduledTaskUpdate extends Partial<ScheduledTaskInput> {
  id: string
}

export interface ScheduledTaskRun {
  id: string
  taskId: string
  scheduledAt: number
  sessionId?: string
  status: ScheduledTaskRunStatus
  startedAt?: number
  finishedAt?: number
  errorCode?: string
  errorMessage?: string
}

export interface ScheduledTasksEvent {
  type: 'changed'
  taskId?: string
  runId?: string
}

export type RuntimeEvent =
  | { type: 'session-updated'; session: SessionRecord }
  | { type: 'interaction-requested'; interaction: PendingInteraction }
  | { type: 'interaction-cancelled'; interactionId: string }
  | { type: 'host-status'; status: RuntimeHostStatus }

export interface HarnessStudioApi {
  application: {
    onOpenSettings(listener: () => void): () => void
  }
  sessions: {
    list(scope: SessionScope): Promise<SessionSummary[]>
    get(scope: SessionScope, sessionId: string): Promise<SessionRecord | undefined>
    create(scope: SessionScope, cwd?: string): Promise<SessionRecord>
    delete(scope: SessionScope, sessionId: string): Promise<void>
    run(scope: SessionScope, sessionId: string, submission: ComposerSubmission): Promise<RunReceipt>
    cancel(scope: SessionScope, sessionId: string): Promise<void>
    selectModel(scope: SessionScope, sessionId: string, selection: ModelSelection): Promise<ModelSelection>
    commands(sessionId: string): Promise<CommandSummary[]>
    command(scope: SessionScope, sessionId: string, submission: ComposerCommandSubmission): Promise<void>
  }
  models: {
    getConfiguration(): Promise<ModelConfiguration>
    updateConfiguration(update: ModelConfigurationUpdate): Promise<ModelConfiguration>
    discover(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResult>
    test(request: ModelTestRequest): Promise<ModelTestResult>
  }
  skills: {
    list(sessionId: string): Promise<SkillEntry[]>
    import(sessionId: string): Promise<SkillEntry | undefined>
    setEnabled(sessionId: string, name: string, enabled: boolean): Promise<SkillEntry[]>
  }
  permissions: {
    get(sessionId: string): Promise<PermissionSelection | undefined>
    select(sessionId: string, preset: string): Promise<PermissionSelection>
    listPending(): Promise<PendingInteraction[]>
    answerApproval(interactionId: string, decision: ApprovalDecision): Promise<void>
    answerQuestions(interactionId: string, answers: QuestionAnswer[]): Promise<void>
    cancel(interactionId: string): Promise<void>
  }
  mcp: {
    list(): Promise<McpServerSummary[]>
    save(server: McpServerInput): Promise<McpServerSummary[]>
    remove(id: string): Promise<McpServerSummary[]>
    test(id: string): Promise<McpServerSummary>
  }
  context: {
    get(sessionId: string): Promise<ContextStatus>
    compact(sessionId: string): Promise<ContextCompactResult>
  }
  memory: {
    search(query: string, limit?: number): Promise<MemoryEntry[]>
    remove(id: string): Promise<void>
    clear(): Promise<void>
  }
  scheduledTasks: {
    list(): Promise<ScheduledTask[]>
    create(input: ScheduledTaskInput): Promise<ScheduledTask>
    update(input: ScheduledTaskUpdate): Promise<ScheduledTask>
    remove(id: string): Promise<void>
    setEnabled(id: string, enabled: boolean): Promise<ScheduledTask>
    runNow(id: string): Promise<ScheduledTaskRun>
    cancelRun(runId: string): Promise<void>
    listRuns(taskId: string, limit?: number): Promise<ScheduledTaskRun[]>
    subscribe(listener: (event: ScheduledTasksEvent) => void): () => void
  }
  workspace: {
    pick(): Promise<string | undefined>
    pickFiles(scope: SessionScope, sessionId: string): Promise<ComposerFileAttachment[]>
    files(sessionId: string, query: string): Promise<FileCandidate[]>
    changes(scope: SessionScope, sessionId: string): Promise<WorkspaceChanges>
    diff(scope: SessionScope, sessionId: string, path: string): Promise<WorkspaceFileDiff>
    listDirectory(scope: SessionScope, sessionId: string, path?: string): Promise<WorkspaceTreeEntry[]>
    readFile(scope: SessionScope, sessionId: string, path: string): Promise<WorkspaceFileContent>
  }
  runtime: {
    mode(): Promise<'simulation' | 'harness'>
    status(): Promise<RuntimeHostStatus>
    subscribe(listener: (event: RuntimeEvent) => void): () => void
  }
}

export const IPC = {
  applicationOpenSettings: 'harness-studio:application:open-settings',
  sessionsList: 'harness-studio:sessions:list',
  sessionGet: 'harness-studio:session:get',
  sessionCreate: 'harness-studio:session:create',
  sessionDelete: 'harness-studio:session:delete',
  sessionRun: 'harness-studio:session:run',
  sessionCancel: 'harness-studio:session:cancel',
  sessionSelectModel: 'harness-studio:session:select-model',
  sessionCommands: 'harness-studio:session:commands',
  sessionCommand: 'harness-studio:session:command',
  modelsGetConfiguration: 'harness-studio:models:get-configuration',
  modelsUpdateConfiguration: 'harness-studio:models:update-configuration',
  modelsDiscover: 'harness-studio:models:discover',
  modelsTest: 'harness-studio:models:test',
  skillsList: 'harness-studio:skills:list',
  skillsImport: 'harness-studio:skills:import',
  skillsSetEnabled: 'harness-studio:skills:set-enabled',
  permissionsListPending: 'harness-studio:permissions:list-pending',
  permissionsGet: 'harness-studio:permissions:get',
  permissionsSelect: 'harness-studio:permissions:select',
  permissionsAnswerApproval: 'harness-studio:permissions:answer-approval',
  permissionsAnswerQuestions: 'harness-studio:permissions:answer-questions',
  permissionsCancel: 'harness-studio:permissions:cancel',
  mcpList: 'harness-studio:mcp:list',
  mcpSave: 'harness-studio:mcp:save',
  mcpRemove: 'harness-studio:mcp:remove',
  mcpTest: 'harness-studio:mcp:test',
  contextGet: 'harness-studio:context:get',
  contextCompact: 'harness-studio:context:compact',
  memorySearch: 'harness-studio:memory:search',
  memoryRemove: 'harness-studio:memory:remove',
  memoryClear: 'harness-studio:memory:clear',
  scheduledTasksList: 'harness-studio:scheduled-tasks:list',
  scheduledTaskCreate: 'harness-studio:scheduled-task:create',
  scheduledTaskUpdate: 'harness-studio:scheduled-task:update',
  scheduledTaskRemove: 'harness-studio:scheduled-task:remove',
  scheduledTaskSetEnabled: 'harness-studio:scheduled-task:set-enabled',
  scheduledTaskRunNow: 'harness-studio:scheduled-task:run-now',
  scheduledTaskCancelRun: 'harness-studio:scheduled-task:cancel-run',
  scheduledTaskRuns: 'harness-studio:scheduled-task:runs',
  scheduledTasksEvent: 'harness-studio:scheduled-tasks:event',
  workspacePick: 'harness-studio:workspace:pick',
  workspacePickFile: 'harness-studio:workspace:pick-file',
  workspaceFiles: 'harness-studio:workspace:files',
  workspaceChanges: 'harness-studio:workspace:changes',
  workspaceDiff: 'harness-studio:workspace:diff',
  workspaceListDirectory: 'harness-studio:workspace:list-directory',
  workspaceReadFile: 'harness-studio:workspace:read-file',
  runtimeMode: 'harness-studio:runtime:mode',
  runtimeStatus: 'harness-studio:runtime:status',
  runtimeEvent: 'harness-studio:runtime:event',
} as const
