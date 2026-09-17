import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session as electronSession,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import { basename, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  IPC,
  type ApprovalDecision,
  type ComposerCommandSubmission,
  type ComposerImageUpload,
  type ComposerPastedImage,
  type ComposerSubmission,
  type ModelConfigurationUpdate,
  type ModelDiscoveryRequest,
  type ModelSelection,
  type ModelTestRequest,
  type McpServerInput,
  type QuestionAnswer,
  type RuntimeEvent,
  type ScheduledTaskInput,
  type ScheduledTaskUpdate,
  type SessionScope,
} from '../shared/contracts.js'
import { HarnessHostProcess } from './runtime/dsh-host-process.js'
import { prepareDevelopmentHarness } from './runtime/harness-development.js'
import { preparePackagedHarness } from './runtime/harness-packaged.js'
import { HarnessAgentRuntime } from './runtime/harness-runtime.js'
import { HarnessRuntimeSupervisor } from './runtime/harness-supervisor.js'
import { StudioRuntime } from './runtime/studio-runtime.js'
import { MockAgentRuntime } from './runtime/mock-runtime.js'
import { SessionStore } from './runtime/session-store.js'
import { LocalSkillLibrary } from './runtime/skill-library.js'
import { McpManager } from './runtime/mcp-manager.js'
import { MemoryStore } from './runtime/memory-store.js'
import { HarnessCredentialResolver } from './runtime/model-connection-test.js'
import { EXPECTED_DSH_VERSION } from './runtime/dsh-host-protocol.js'
import { systemProxyEnvironment } from './runtime/system-proxy.js'
import {
  listWorkspaceDirectory,
  readWorkspaceChanges,
  readWorkspaceDiff,
  readWorkspaceFile,
} from './runtime/workspace-inspector.js'

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
const userDataArgument = process.argv.find(argument => argument.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
if (userDataArgument !== undefined && isAbsolute(userDataArgument)) app.setPath('userData', userDataArgument)
app.setName('Harness Studio')
let mainWindow: BrowserWindow | undefined
let runtime: StudioRuntime | undefined
let quitting = false
let shutdown: Promise<void> | undefined
let memoryStore: MemoryStore | undefined

const CLIPBOARD_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_CLIPBOARD_IMAGE_BYTES = 25 * 1024 * 1024
const ATTACHMENT_ID_PATTERN = /^sha256:([a-f0-9]{64})$/u

function validatedClipboardImage(image: ComposerImageUpload): ComposerImageUpload {
  if (typeof image !== 'object' || image === null || !(image.bytes instanceof Uint8Array)) {
    throw new Error('剪贴板图片数据无效')
  }
  if (!CLIPBOARD_IMAGE_TYPES.has(image.mediaType)) {
    throw new Error('仅支持 PNG、JPEG、WebP 和 GIF 图片')
  }
  if (image.bytes.byteLength === 0) throw new Error('剪贴板图片为空')
  if (image.bytes.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error('单张图片不能超过 25 MB')
  }
  const name = basename(image.name.trim()).slice(0, 180)
  if (name === '') throw new Error('剪贴板图片缺少文件名')
  return {
    name,
    mediaType: image.mediaType,
    bytes: new Uint8Array(image.bytes),
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1f1e1b',
    show: false,
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.HARNESS_STUDIO_DEV_SERVER
    if (devServer === undefined || !url.startsWith(devServer)) event.preventDefault()
  })
  window.webContents.on('preload-error', (_event, path, error) => {
    console.error(`Harness Studio preload failed at ${path}:`, error)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Harness Studio page failed to load (${String(code)} ${description}): ${url}`)
    window.show()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    runtime?.setInteractionAnswererAvailable(false)
    console.error('Harness Studio renderer stopped:', details)
  })
  window.once('closed', () => runtime?.setInteractionAnswererAvailable(false))
  window.webContents.once('did-finish-load', () => window.show())
  window.once('ready-to-show', () => window.show())
  return window
}

const devServer = process.env.HARNESS_STUDIO_DEV_SERVER

async function loadApplicationWindow(): Promise<void> {
  mainWindow = createWindow()
  if (devServer !== undefined) await mainWindow.loadURL(devServer)
  else await mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'))
}

function openSettings(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) {
    void loadApplicationWindow().then(() => {
      mainWindow?.webContents.send(IPC.applicationOpenSettings)
    })
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  mainWindow.webContents.send(IPC.applicationOpenSettings)
}

function installApplicationMenu(): void {
  const applicationMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about', label: `关于 ${app.name}` },
      { type: 'separator' },
      {
        label: '设置…',
        accelerator: 'CommandOrControl+,',
        click: openSettings,
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit', label: `退出 ${app.name}` },
    ],
  }
  const template: MenuItemConstructorOptions[] = process.platform === 'darwin'
    ? [
      applicationMenu,
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]
    : [
      {
        role: 'fileMenu',
        submenu: [
          { label: '设置…', accelerator: 'CommandOrControl+,', click: openSettings },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function resolveSessionCreation(
  scopeOrCwd: SessionScope | string | undefined,
  cwd: string | undefined,
): { scope: SessionScope; cwd?: string } {
  if (scopeOrCwd === 'daily' || scopeOrCwd === 'project') {
    return { scope: scopeOrCwd, ...(cwd === undefined ? {} : { cwd }) }
  }
  return { scope: 'project', ...(scopeOrCwd === undefined ? {} : { cwd: scopeOrCwd }) }
}

function registerIpc(agentRuntime: StudioRuntime, mcpManager: McpManager, memories: MemoryStore): void {
  const workspaceRoot = async (scope: SessionScope, sessionId: string): Promise<string> => {
    if (scope !== 'project') throw new Error('Only project Sessions expose workspace files')
    const session = await agentRuntime.getSession(scope, sessionId)
    if (session === undefined || session.cwd === '') throw new Error('Session workspace is unavailable')
    return session.cwd
  }

  ipcMain.handle(IPC.sessionsList, (_event, scope: SessionScope) => agentRuntime.listSessions(scope))
  ipcMain.handle(IPC.sessionGet, (_event, scope: SessionScope, sessionId: string) =>
    agentRuntime.getSession(scope, sessionId))
  ipcMain.handle(IPC.sessionCreate, async (_event, scopeOrCwd: SessionScope | string | undefined, cwd?: string) => {
    const request = resolveSessionCreation(scopeOrCwd, cwd)
    try {
      return await agentRuntime.createSession(request.scope, request.cwd)
    } catch (error) {
      console.error(`Harness Studio failed to create a ${request.scope} session:`, error)
      throw new Error(request.scope === 'daily'
        ? '新建对话失败，请稍后重试。'
        : '新建任务失败，请确认项目文件夹仍可访问，然后重试。')
    }
  })
  ipcMain.handle(IPC.sessionRun, (_event, scope: SessionScope, sessionId: string, submission: ComposerSubmission) =>
    agentRuntime.run(scope, sessionId, submission))
  ipcMain.handle(IPC.sessionDelete, async (_event, scope: SessionScope, sessionId: string) => {
    try {
      await agentRuntime.deleteSession(scope, sessionId)
    } catch (error) {
      console.error(`Harness Studio failed to delete a ${scope} session:`, error)
      if (error instanceof Error && error.message === '请先停止当前会话，再删除。') throw error
      throw new Error('删除会话失败，请稍后重试。')
    }
  })
  ipcMain.handle(IPC.sessionCancel, (_event, scope: SessionScope, sessionId: string) =>
    agentRuntime.cancel(scope, sessionId))
  ipcMain.handle(
    IPC.sessionSelectModel,
    (_event, scope: SessionScope, sessionId: string, selection: ModelSelection) =>
      agentRuntime.selectModel(scope, sessionId, selection),
  )
  ipcMain.handle(IPC.sessionCommands, (_event, sessionId: string) =>
    agentRuntime.listCommands(sessionId))
  ipcMain.handle(IPC.sessionCommand, (
    _event,
    scope: SessionScope,
    sessionId: string,
    submission: ComposerCommandSubmission,
  ) => agentRuntime.runCommand(scope, sessionId, submission))
  ipcMain.handle(IPC.modelsGetConfiguration, () => agentRuntime.getModelConfiguration())
  ipcMain.handle(
    IPC.modelsUpdateConfiguration,
    (_event, update: ModelConfigurationUpdate) => agentRuntime.updateModelConfiguration(update),
  )
  ipcMain.handle(
    IPC.modelsDiscover,
    (_event, request: ModelDiscoveryRequest) => agentRuntime.discoverModels(request),
  )
  ipcMain.handle(
    IPC.modelsTest,
    (_event, request: ModelTestRequest) => agentRuntime.testModel(request),
  )
  ipcMain.handle(IPC.skillsList, (_event, sessionId: string) => agentRuntime.listSkills(sessionId))
  ipcMain.handle(IPC.skillsImport, async (_event, sessionId: string) => {
    const options: Electron.OpenDialogOptions = {
      title: '导入 Skill',
      buttonLabel: '导入',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Skill Markdown', extensions: ['md'] }],
    }
    const result = mainWindow === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options)
    const sourcePath = result.filePaths[0]
    return result.canceled || sourcePath === undefined
      ? undefined
      : agentRuntime.importSkill(sessionId, sourcePath)
  })
  ipcMain.handle(
    IPC.skillsSetEnabled,
    (_event, sessionId: string, name: string, enabled: boolean) =>
      agentRuntime.setSkillEnabled(sessionId, name, enabled),
  )
  ipcMain.handle(IPC.permissionsListPending, () => {
    agentRuntime.setInteractionAnswererAvailable(true)
    return agentRuntime.listPendingInteractions()
  })
  ipcMain.handle(IPC.permissionsGet, (_event, sessionId: string) =>
    agentRuntime.getPermissionSelection(sessionId))
  ipcMain.handle(IPC.permissionsSelect, (_event, sessionId: string, preset: string) =>
    agentRuntime.selectPermissionPreset(sessionId, preset))
  ipcMain.handle(
    IPC.permissionsAnswerApproval,
    (_event, interactionId: string, decision: ApprovalDecision) =>
      agentRuntime.answerApproval(interactionId, decision),
  )
  ipcMain.handle(
    IPC.permissionsAnswerQuestions,
    (_event, interactionId: string, answers: QuestionAnswer[]) =>
      agentRuntime.answerQuestions(interactionId, answers),
  )
  ipcMain.handle(
    IPC.permissionsCancel,
    (_event, interactionId: string) => agentRuntime.cancelInteraction(interactionId),
  )
  ipcMain.handle(IPC.mcpList, () => mcpManager.list())
  ipcMain.handle(IPC.mcpSave, (_event, server: McpServerInput) => mcpManager.save(server))
  ipcMain.handle(IPC.mcpRemove, (_event, id: string) => mcpManager.remove(id))
  ipcMain.handle(IPC.mcpTest, (_event, id: string) => mcpManager.test(id))
  ipcMain.handle(IPC.contextGet, (_event, sessionId: string) => agentRuntime.getContextStatus(sessionId))
  ipcMain.handle(IPC.contextCompact, async (_event, sessionId: string) => {
    try {
      return await agentRuntime.compactContext(sessionId)
    } catch (error) {
      console.error('Harness Studio failed to compact the current context:', error)
      throw new Error('上下文压缩失败，请稍后重试。')
    }
  })
  ipcMain.handle(IPC.memorySearch, (_event, query: string, limit?: number) => memories.search(query, limit))
  ipcMain.handle(IPC.memoryRemove, (_event, id: string) => memories.remove(id))
  ipcMain.handle(IPC.memoryClear, () => memories.clear())
  const scheduledChanged = (taskId?: string, runId?: string): void => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.scheduledTasksEvent, { type: 'changed', taskId, runId })
    }
  }
  ipcMain.handle(IPC.scheduledTasksList, () => agentRuntime.listScheduledTasks())
  ipcMain.handle(IPC.scheduledTaskCreate, async (_event, input: ScheduledTaskInput) => {
    const task = await agentRuntime.createScheduledTask(input)
    scheduledChanged(task.id)
    return task
  })
  ipcMain.handle(IPC.scheduledTaskUpdate, async (_event, input: ScheduledTaskUpdate) => {
    const task = await agentRuntime.updateScheduledTask(input)
    scheduledChanged(task.id)
    return task
  })
  ipcMain.handle(IPC.scheduledTaskRemove, async (_event, id: string) => {
    await agentRuntime.removeScheduledTask(id)
    scheduledChanged(id)
  })
  ipcMain.handle(IPC.scheduledTaskSetEnabled, async (_event, id: string, enabled: boolean) => {
    const task = await agentRuntime.setScheduledTaskEnabled(id, enabled)
    scheduledChanged(id)
    return task
  })
  ipcMain.handle(IPC.scheduledTaskRunNow, async (_event, id: string) => {
    const run = await agentRuntime.runScheduledTaskNow(id)
    scheduledChanged(id, run.id)
    return run
  })
  ipcMain.handle(IPC.scheduledTaskCancelRun, async (_event, id: string) => {
    await agentRuntime.cancelScheduledTaskRun(id)
    scheduledChanged(undefined, id)
  })
  ipcMain.handle(IPC.scheduledTaskRuns, (_event, taskId: string, limit?: number) =>
    agentRuntime.listScheduledTaskRuns(taskId, limit))
  ipcMain.handle(IPC.runtimeMode, () => agentRuntime.mode)
  ipcMain.handle(IPC.runtimeStatus, () => agentRuntime.getHostStatus())
  ipcMain.handle(IPC.workspacePick, async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择代码项目',
      buttonLabel: '打开项目',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = mainWindow === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options)
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle(IPC.workspacePickFile, async (_event, scope: SessionScope, sessionId: string) => {
    const options: Electron.OpenDialogOptions = {
      title: '选择要提供给模型的文件',
      buttonLabel: '添加文件',
      properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
    }
    const result = mainWindow === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options)
    if (result.canceled) return []
    try {
      return await Promise.all(result.filePaths.map(path => agentRuntime.uploadFile(scope, sessionId, path)))
    } catch (error) {
      console.error('Harness Studio failed to add selected files:', error)
      throw new Error('文件添加失败，请确认文件仍可访问，然后重试。')
    }
  })
  ipcMain.handle(IPC.workspaceUploadImage, async (
    _event,
    scope: SessionScope,
    sessionId: string,
    input: ComposerImageUpload,
  ) => {
    try {
      return await agentRuntime.uploadImage(scope, sessionId, validatedClipboardImage(input))
    } catch (error) {
      console.error('Harness Studio failed to add a clipboard image:', error)
      throw new Error(error instanceof Error ? error.message : '剪贴板图片添加失败')
    }
  })
  ipcMain.handle(IPC.workspacePasteImage, async (
    _event,
    scope: SessionScope,
    sessionId: string,
  ): Promise<ComposerPastedImage | undefined> => {
    const items = await clipboard.read()
    const imageEntry = items.flatMap(item => item.types
      .filter(type => type.startsWith('image/'))
      .map(type => ({ item, type })))[0]
    if (imageEntry === undefined) return undefined
    const value = await imageEntry.item.getType(imageEntry.type)
    if (!(value instanceof Blob)) return undefined
    const clipboardImage = nativeImage.createFromBuffer(Buffer.from(await value.arrayBuffer()))
    if (clipboardImage.isEmpty()) return undefined
    try {
      const original = clipboardImage.toPNG()
      const attachment = await agentRuntime.uploadImage(scope, sessionId, validatedClipboardImage({
        name: `pasted-image-${String(Date.now())}.png`,
        mediaType: 'image/png',
        bytes: original,
      }))
      const size = clipboardImage.getSize()
      const preview = size.width > 360
        ? clipboardImage.resize({ width: 360, quality: 'good' })
        : clipboardImage
      return {
        attachment,
        mediaType: 'image/png',
        previewDataUrl: preview.toDataURL(),
      }
    } catch (error) {
      console.error('Harness Studio failed to paste the native clipboard image:', error)
      throw new Error(error instanceof Error ? error.message : '剪贴板图片添加失败')
    }
  })
  ipcMain.handle(IPC.workspaceAttachmentPreview, async (_event, attachmentId: string) => {
    const match = ATTACHMENT_ID_PATTERN.exec(attachmentId)
    if (match === null) return undefined
    const digest = match[1]!
    const runtimeFolder = app.isPackaged || process.env.HARNESS_STUDIO_RUNTIME === 'harness'
      ? app.isPackaged ? 'harness' : 'harness-development'
      : 'harness-development'
    const path = join(
      app.getPath('userData'),
      runtimeFolder,
      'home',
      'attachments',
      'v1',
      'file-objects',
      digest.slice(0, 2),
      digest,
    )
    try {
      const image = nativeImage.createFromBuffer(await readFile(path))
      if (image.isEmpty()) return undefined
      const size = image.getSize()
      const preview = Math.max(size.width, size.height) > 480
        ? size.width >= size.height
          ? image.resize({ width: 480, quality: 'good' })
          : image.resize({ height: 480, quality: 'good' })
        : image
      return preview.toDataURL()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      console.error(`Harness Studio failed to read attachment preview ${attachmentId}:`, error)
      return undefined
    }
  })
  ipcMain.handle(IPC.workspaceFiles, (_event, sessionId: string, query: string) =>
    agentRuntime.listWorkspaceFiles(sessionId, query))
  ipcMain.handle(IPC.workspaceChanges, async (_event, scope: SessionScope, sessionId: string) => {
    try {
      return await readWorkspaceChanges(await workspaceRoot(scope, sessionId))
    } catch (error) {
      console.error('Harness Studio failed to read project changes:', error)
      throw new Error('项目变更读取失败，请确认项目仍可访问。')
    }
  })
  ipcMain.handle(IPC.workspaceDiff, async (
    _event,
    scope: SessionScope,
    sessionId: string,
    path: string,
  ) => {
    try {
      return await readWorkspaceDiff(await workspaceRoot(scope, sessionId), path)
    } catch (error) {
      console.error(`Harness Studio failed to read the diff for ${path}:`, error)
      throw new Error('文件变更读取失败，请稍后重试。')
    }
  })
  ipcMain.handle(IPC.workspaceListDirectory, async (
    _event,
    scope: SessionScope,
    sessionId: string,
    path?: string,
  ) => {
    try {
      return await listWorkspaceDirectory(await workspaceRoot(scope, sessionId), path)
    } catch (error) {
      console.error(`Harness Studio failed to list the project directory ${path ?? '.'}:`, error)
      throw new Error('项目文件读取失败，请确认项目仍可访问。')
    }
  })
  ipcMain.handle(IPC.workspaceReadFile, async (
    _event,
    scope: SessionScope,
    sessionId: string,
    path: string,
  ) => {
    try {
      return await readWorkspaceFile(await workspaceRoot(scope, sessionId), path)
    } catch (error) {
      console.error(`Harness Studio failed to read the project file ${path}:`, error)
      throw new Error('文件内容读取失败，请确认文件仍可访问。')
    }
  })
  agentRuntime.subscribe((event: RuntimeEvent) => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.runtimeEvent, event)
    }
  })
}

interface ApplicationServices {
  runtime: StudioRuntime
  mcpManager: McpManager
  memoryStore: MemoryStore
}

async function createRuntime(): Promise<ApplicationServices> {
  if (!app.isPackaged && process.env.HARNESS_STUDIO_RUNTIME !== 'harness') {
    const dataRoot = app.getPath('userData')
    const sharedSkills = new LocalSkillLibrary(
      join(dataRoot, 'simulation-skills'),
      join(dataRoot, 'simulation-skills-disabled'),
    )
    const project = new MockAgentRuntime(
      new SessionStore(join(dataRoot, 'state', 'sessions.json'), 'project'),
      sharedSkills,
      'project',
    )
    const daily = new MockAgentRuntime(
      new SessionStore(join(dataRoot, 'state', 'daily-sessions.json'), 'daily'),
      sharedSkills,
      'daily',
    )
    const dailyWorkingDirectory = join(dataRoot, 'daily-workspace')
    mkdirSync(dailyWorkingDirectory, { recursive: true })
    const studioRuntime = new StudioRuntime(daily, project, dailyWorkingDirectory)
    const memories = new MemoryStore(join(dataRoot, 'memory', 'memory.sqlite'))
    const mcpManager = new McpManager(
      join(dataRoot, 'state', 'simulation-mcp.json'),
      join(dataRoot, 'state', 'simulation-profile.json'),
      () => Promise.resolve(),
    )
    return { runtime: studioRuntime, mcpManager, memoryStore: memories }
  }
  const packagedRuntime = join(process.resourcesPath, 'runtime')
  const upstreamRoot = process.env.HARNESS_STUDIO_UPSTREAM_ROOT ?? join(app.getAppPath(), 'vendor', 'deepseek-harness')
  const nodeExecutable = app.isPackaged
    ? join(packagedRuntime, 'node', 'node')
    : process.env.HARNESS_STUDIO_NODE_EXECUTABLE ?? process.env.npm_node_execpath
  if (nodeExecutable === undefined) {
    throw new Error('Harness mode requires HARNESS_STUDIO_NODE_EXECUTABLE in Electron development builds')
  }
  const runtimeRoot = app.isPackaged
    ? join(app.getPath('userData'), 'harness')
    : join(app.getPath('userData'), 'harness-development')
  const sharedHome = join(runtimeRoot, 'home')
  const projectPaths = app.isPackaged
    ? await preparePackagedHarness(join(packagedRuntime, 'harness'), runtimeRoot, sharedHome)
    : await prepareDevelopmentHarness(upstreamRoot, runtimeRoot, sharedHome)
  const dailyPaths = app.isPackaged
    ? await preparePackagedHarness(join(packagedRuntime, 'harness'), join(runtimeRoot, 'daily'), sharedHome)
    : await prepareDevelopmentHarness(upstreamRoot, join(runtimeRoot, 'daily'), sharedHome)
  const skillLibrary = new LocalSkillLibrary(
    join(sharedHome, 'skills'),
    join(sharedHome, 'skills-disabled'),
  )
  const memoryDatabase = join(app.getPath('userData'), 'memory', 'memory.sqlite')
  const memories = new MemoryStore(memoryDatabase)
  let projectSupervisor: HarnessRuntimeSupervisor | undefined
  let dailySupervisor: HarnessRuntimeSupervisor | undefined
  const mcpManager = new McpManager(
    join(sharedHome, 'harness-studio-mcp.json'),
    [
      {
        profilePath: join(projectPaths.profileDir, 'cordis.patch.yml'),
        sessionRoot: join(sharedHome, 'sessions'),
      },
      {
        profilePath: join(dailyPaths.profileDir, 'cordis.patch.yml'),
        sessionRoot: join(sharedHome, 'daily-sessions'),
      },
    ],
    async () => {
      if (projectSupervisor === undefined || dailySupervisor === undefined) {
        throw new Error('Harness Host 尚未启动')
      }
      await Promise.all([
        projectSupervisor.restart('MCP 配置已改变'),
        dailySupervisor.restart('MCP 配置已改变'),
      ])
    },
    {
      command: nodeExecutable,
      scriptPath: app.isPackaged
        ? join(packagedRuntime, 'harness', 'harness-studio', 'memory-mcp-server.js')
        : join(currentDirectory, 'runtime', 'memory-mcp-server.js'),
      databasePath: memoryDatabase,
    },
  )
  await mcpManager.list()
  const proxyEnvironment = await systemProxyEnvironment(
    url => electronSession.defaultSession.resolveProxy(url),
    process.env,
  )
  const credentialResolver = new HarnessCredentialResolver({
    homeDir: sharedHome,
    projectDir: projectPaths.profileDir,
  })
  const createSupervisor = (paths: typeof projectPaths, scope: SessionScope) =>
    HarnessRuntimeSupervisor.create(async onFailure => {
      const host = new HarnessHostProcess({
        nodeExecutable,
        runtimeDir: paths.runtimeDir,
        projectDir: paths.profileDir,
        allowLinkedProfile: !app.isPackaged,
        expectedDshVersion: EXPECTED_DSH_VERSION,
        environment: {
          ...proxyEnvironment,
          DSH_HOME: sharedHome,
          HARNESS_STUDIO_SCOPE: scope,
          ...(process.env.DEEPSEEK_API_KEY === undefined
            ? {}
            : { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY }),
          ...(process.env.DEEPSEEK_BASE_URL === undefined
            ? {}
            : { DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL }),
        },
        onFailure,
      })
      return HarnessAgentRuntime.create(
        host,
        scope,
        skillLibrary,
        ref => credentialResolver.resolve(ref),
      )
    })
  projectSupervisor = await createSupervisor(projectPaths, 'project')
  try {
    dailySupervisor = await createSupervisor(dailyPaths, 'daily')
  } catch (error) {
    await projectSupervisor.dispose()
    throw error
  }
  const dailyWorkingDirectory = join(app.getPath('userData'), 'daily-workspace')
  mkdirSync(dailyWorkingDirectory, { recursive: true })
  return {
    runtime: new StudioRuntime(dailySupervisor, projectSupervisor, dailyWorkingDirectory),
    mcpManager,
    memoryStore: memories,
  }
}

function beginShutdown(exitCode = 0): void {
  if (shutdown !== undefined) return
  quitting = true
  shutdown = Promise.resolve(runtime?.dispose())
    .catch(error => {
      console.error('Harness Studio runtime shutdown failed:', error)
    })
    .finally(() => {
      memoryStore?.close()
      app.exit(exitCode)
    })
}

async function bootstrap(): Promise<void> {
  // Session stores live under shared userData paths; a second instance would race on them.
  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
    return
  }
  app.on('second-instance', () => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  await app.whenReady()
  installApplicationMenu()
  const services = await createRuntime()
  runtime = services.runtime
  memoryStore = services.memoryStore
  registerIpc(runtime, services.mcpManager, services.memoryStore)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void loadApplicationWindow()
  })
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    beginShutdown()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  await loadApplicationWindow()
}

process.once('SIGTERM', () => { beginShutdown() })
process.once('SIGINT', () => { beginShutdown(130) })

void bootstrap().catch(error => {
  console.error('Harness Studio failed to start:', error)
  try {
    const logRoot = join(app.getPath('userData'), 'logs')
    mkdirSync(logRoot, { recursive: true })
    const raw = error instanceof Error ? error.stack ?? error.message : String(error)
    const redacted = raw
      .replace(/Bearer\s+[^\s"']+/giu, 'Bearer [REDACTED]')
      .replace(/\b(?:sk|key)-[A-Za-z0-9._-]+/gu, '[REDACTED]')
      .replace(/(api[_ -]?key["']?\s*[:=]\s*["']?)[^\s,"']+/giu, '$1[REDACTED]')
    appendFileSync(join(logRoot, 'startup.log'), `${new Date().toISOString()} ${redacted}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {}
  beginShutdown(1)
})
