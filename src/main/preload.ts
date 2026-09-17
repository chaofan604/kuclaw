import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type HarnessStudioApi, type RuntimeEvent, type ScheduledTasksEvent } from '../shared/contracts.js'

const api: HarnessStudioApi = {
  application: {
    onOpenSettings(listener) {
      const handler = (): void => listener()
      ipcRenderer.on(IPC.applicationOpenSettings, handler)
      return () => ipcRenderer.off(IPC.applicationOpenSettings, handler)
    },
  },
  sessions: {
    list: scope => ipcRenderer.invoke(IPC.sessionsList, scope),
    get: (scope, sessionId) => ipcRenderer.invoke(IPC.sessionGet, scope, sessionId),
    create: (scope, cwd) => ipcRenderer.invoke(IPC.sessionCreate, scope, cwd),
    delete: (scope, sessionId) => ipcRenderer.invoke(IPC.sessionDelete, scope, sessionId),
    run: (scope, sessionId, submission) => ipcRenderer.invoke(IPC.sessionRun, scope, sessionId, submission),
    cancel: (scope, sessionId) => ipcRenderer.invoke(IPC.sessionCancel, scope, sessionId),
    selectModel: (scope, sessionId, selection) =>
      ipcRenderer.invoke(IPC.sessionSelectModel, scope, sessionId, selection),
    commands: sessionId => ipcRenderer.invoke(IPC.sessionCommands, sessionId),
    command: (scope, sessionId, submission) => ipcRenderer.invoke(IPC.sessionCommand, scope, sessionId, submission),
  },
  models: {
    getConfiguration: () => ipcRenderer.invoke(IPC.modelsGetConfiguration),
    updateConfiguration: update => ipcRenderer.invoke(IPC.modelsUpdateConfiguration, update),
    discover: request => ipcRenderer.invoke(IPC.modelsDiscover, request),
    test: request => ipcRenderer.invoke(IPC.modelsTest, request),
  },
  skills: {
    list: sessionId => ipcRenderer.invoke(IPC.skillsList, sessionId),
    import: sessionId => ipcRenderer.invoke(IPC.skillsImport, sessionId),
    setEnabled: (sessionId, name, enabled) =>
      ipcRenderer.invoke(IPC.skillsSetEnabled, sessionId, name, enabled),
  },
  permissions: {
    get: sessionId => ipcRenderer.invoke(IPC.permissionsGet, sessionId),
    select: (sessionId, preset) => ipcRenderer.invoke(IPC.permissionsSelect, sessionId, preset),
    listPending: () => ipcRenderer.invoke(IPC.permissionsListPending),
    answerApproval: (interactionId, decision) =>
      ipcRenderer.invoke(IPC.permissionsAnswerApproval, interactionId, decision),
    answerQuestions: (interactionId, answers) =>
      ipcRenderer.invoke(IPC.permissionsAnswerQuestions, interactionId, answers),
    cancel: interactionId => ipcRenderer.invoke(IPC.permissionsCancel, interactionId),
  },
  mcp: {
    list: () => ipcRenderer.invoke(IPC.mcpList),
    save: server => ipcRenderer.invoke(IPC.mcpSave, server),
    remove: id => ipcRenderer.invoke(IPC.mcpRemove, id),
    test: id => ipcRenderer.invoke(IPC.mcpTest, id),
  },
  context: {
    get: sessionId => ipcRenderer.invoke(IPC.contextGet, sessionId),
    compact: sessionId => ipcRenderer.invoke(IPC.contextCompact, sessionId),
  },
  memory: {
    search: (query, limit) => ipcRenderer.invoke(IPC.memorySearch, query, limit),
    remove: id => ipcRenderer.invoke(IPC.memoryRemove, id),
    clear: () => ipcRenderer.invoke(IPC.memoryClear),
  },
  scheduledTasks: {
    list: () => ipcRenderer.invoke(IPC.scheduledTasksList),
    create: input => ipcRenderer.invoke(IPC.scheduledTaskCreate, input),
    update: input => ipcRenderer.invoke(IPC.scheduledTaskUpdate, input),
    remove: id => ipcRenderer.invoke(IPC.scheduledTaskRemove, id),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.scheduledTaskSetEnabled, id, enabled),
    runNow: id => ipcRenderer.invoke(IPC.scheduledTaskRunNow, id),
    cancelRun: id => ipcRenderer.invoke(IPC.scheduledTaskCancelRun, id),
    listRuns: (taskId, limit) => ipcRenderer.invoke(IPC.scheduledTaskRuns, taskId, limit),
    subscribe(listener) {
      const handler = (_event: Electron.IpcRendererEvent, payload: ScheduledTasksEvent): void => listener(payload)
      ipcRenderer.on(IPC.scheduledTasksEvent, handler)
      return () => ipcRenderer.off(IPC.scheduledTasksEvent, handler)
    },
  },
  workspace: {
    pick: () => ipcRenderer.invoke(IPC.workspacePick),
    pickFiles: (scope, sessionId) => ipcRenderer.invoke(IPC.workspacePickFile, scope, sessionId),
    pasteImage: (scope, sessionId) =>
      ipcRenderer.invoke(IPC.workspacePasteImage, scope, sessionId),
    uploadImage: (scope, sessionId, image) =>
      ipcRenderer.invoke(IPC.workspaceUploadImage, scope, sessionId, image),
    attachmentPreview: attachmentId =>
      ipcRenderer.invoke(IPC.workspaceAttachmentPreview, attachmentId),
    files: (sessionId, query) => ipcRenderer.invoke(IPC.workspaceFiles, sessionId, query),
    changes: (scope, sessionId) => ipcRenderer.invoke(IPC.workspaceChanges, scope, sessionId),
    diff: (scope, sessionId, path) => ipcRenderer.invoke(IPC.workspaceDiff, scope, sessionId, path),
    listDirectory: (scope, sessionId, path) =>
      ipcRenderer.invoke(IPC.workspaceListDirectory, scope, sessionId, path),
    readFile: (scope, sessionId, path) => ipcRenderer.invoke(IPC.workspaceReadFile, scope, sessionId, path),
  },
  runtime: {
    mode: () => ipcRenderer.invoke(IPC.runtimeMode),
    status: () => ipcRenderer.invoke(IPC.runtimeStatus),
    subscribe(listener) {
      const handler = (_event: Electron.IpcRendererEvent, payload: RuntimeEvent): void => listener(payload)
      ipcRenderer.on(IPC.runtimeEvent, handler)
      return () => ipcRenderer.off(IPC.runtimeEvent, handler)
    },
  },
}

contextBridge.exposeInMainWorld('harnessStudio', api)
