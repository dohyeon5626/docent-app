import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AIStreamChunk,
  AIStreamDone,
  Analysis,
  AnalysisProgress,
  AppSettings,
  CliStatus,
  ConversationEntry,
  LearningPlan,
  LearningSession,
  MenuAction,
  Project,
  ProjectSummary,
  SummaryProgress,
  SyncState,
  WindowMode
} from '@shared/types'

type Unsubscribe = () => void

function on<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const wrapped = (_e: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  // Claude CLI
  cliStatus: (): Promise<CliStatus> => ipcRenderer.invoke(IPC.cliStatus),

  // Projects
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke(IPC.projectList),
  pickPdf: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickPdf),
  createProject: (
    name: string,
    pdfPath: string,
    summaryLevel?: 'brief' | 'standard' | 'detailed',
    summaryLanguage?: 'ko' | 'en'
  ): Promise<Project> =>
    ipcRenderer.invoke(IPC.projectCreate, { name, pdfPath, summaryLevel, summaryLanguage }),
  setProjectSummaryLanguage: (projectId: string, language: 'ko' | 'en'): Promise<Project | null> =>
    ipcRenderer.invoke(IPC.projectSetSummaryLanguage, { projectId, language }),
  setProjectSummaryLevel: (
    projectId: string,
    level: 'brief' | 'standard' | 'detailed'
  ): Promise<Project | null> =>
    ipcRenderer.invoke(IPC.projectSetSummaryLevel, { projectId, level }),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectDelete, id),
  retryAnalysis: (id: string): Promise<Project | null> =>
    ipcRenderer.invoke(IPC.projectRetryAnalysis, id),
  openProject: (id: string): Promise<Project | null> => ipcRenderer.invoke(IPC.projectOpen, id),

  // Project data
  getAnalysis: (id: string): Promise<Analysis | null> => ipcRenderer.invoke(IPC.getAnalysis, id),
  getPlan: (id: string): Promise<LearningPlan | null> => ipcRenderer.invoke(IPC.getPlan, id),
  getSession: (id: string): Promise<LearningSession | null> =>
    ipcRenderer.invoke(IPC.getSession, id),
  getConversation: (id: string): Promise<ConversationEntry[]> =>
    ipcRenderer.invoke(IPC.getConversation, id),
  clearConversation: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.clearConversation, id),
  readPdf: (pdfPath: string): Promise<ArrayBuffer> => ipcRenderer.invoke(IPC.readPdf, pdfPath),

  // Learning
  askQuestion: (projectId: string, question: string): Promise<string> =>
    ipcRenderer.invoke(IPC.askQuestion, { projectId, question }),
  ensureSummaries: (projectId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.ensureSummaries, projectId),
  regeneratePlan: (projectId: string): Promise<LearningPlan | null> =>
    ipcRenderer.invoke(IPC.regeneratePlan, projectId),
  mergeSupplements: (projectId: string, stepId: string): Promise<ConversationEntry[]> =>
    ipcRenderer.invoke(IPC.mergeSupplements, { projectId, stepId }),
  cancelRequest: (requestId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.cancelRequest, requestId),
  updateSession: (
    projectId: string,
    patch: Partial<LearningSession>
  ): Promise<LearningSession | null> =>
    ipcRenderer.invoke(IPC.updateSession, { projectId, patch }),

  // Window / settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  setWindowMode: (mode: WindowMode, projectId?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.setWindowMode, { mode, projectId }),
  setSplitRatio: (ratio: number): Promise<void> => ipcRenderer.invoke(IPC.setSplitRatio, ratio),
  newWindow: (): Promise<void> => ipcRenderer.invoke(IPC.newWindow),
  setTheme: (theme: 'system' | 'light' | 'dark'): Promise<void> =>
    ipcRenderer.invoke(IPC.setTheme, theme),
  setSummaryLevel: (level: 'brief' | 'standard' | 'detailed'): Promise<void> =>
    ipcRenderer.invoke(IPC.setSummaryLevel, level),
  setLanguage: (language: 'ko' | 'en'): Promise<void> =>
    ipcRenderer.invoke(IPC.setLanguage, language),
  setAiModel: (model: 'default' | 'sonnet' | 'opus' | 'fable'): Promise<void> =>
    ipcRenderer.invoke(IPC.setAiModel, model),
  takePendingAction: (): Promise<MenuAction | null> => ipcRenderer.invoke(IPC.pendingAction),

  // Cross-window sync
  broadcastSync: (state: SyncState): void => ipcRenderer.send(IPC.syncBroadcast, state),
  reportScreen: (screen: string): void => ipcRenderer.send(IPC.reportScreen, screen),

  // Events
  onAnalysisProgress: (fn: (p: AnalysisProgress) => void): Unsubscribe =>
    on(IPC.analysisProgress, fn),
  onAiChunk: (fn: (c: AIStreamChunk) => void): Unsubscribe => on(IPC.aiChunk, fn),
  onAiDone: (fn: (d: AIStreamDone) => void): Unsubscribe => on(IPC.aiDone, fn),
  onSessionChanged: (
    fn: (p: { projectId: string; session: LearningSession }) => void
  ): Unsubscribe => on(IPC.sessionChanged, fn),
  onSyncState: (fn: (s: SyncState) => void): Unsubscribe => on(IPC.syncState, fn),
  onMenuAction: (fn: (a: MenuAction) => void): Unsubscribe => on(IPC.menuAction, fn),
  onSummaryAdded: (
    fn: (p: { projectId: string; entry: ConversationEntry }) => void
  ): Unsubscribe => on(IPC.summaryAdded, fn),
  onSummaryProgress: (fn: (p: SummaryProgress & { error?: string }) => void): Unsubscribe =>
    on(IPC.summaryProgress, fn),
  onConversationReplaced: (
    fn: (p: { projectId: string; conversation: ConversationEntry[] }) => void
  ): Unsubscribe => on(IPC.conversationReplaced, fn),
  onSettingsChanged: (fn: (s: AppSettings) => void): Unsubscribe => on(IPC.settingsChanged, fn),
  onFrameState: (fn: (s: { square: boolean }) => void): Unsubscribe => on(IPC.frameState, fn)
}

export type AppApi = typeof api

contextBridge.exposeInMainWorld('api', api)
