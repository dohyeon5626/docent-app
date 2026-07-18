import { dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { newId } from '@shared/id'
import { IPC } from '@shared/ipc'
import type {
  AIStreamDone,
  AnalysisProgress,
  ExportSummaryPdfRequest,
  ExportSummaryPdfResult,
  LearningSession,
  Project,
  ProjectSummary,
  SyncState,
  WindowMode
} from '@shared/types'
import type { AIProvider } from '../services/claude/AIProvider'
import { LearningEngine } from '../services/learning/LearningEngine'
import { analyzeProject, relocalizePlan } from '../services/pdf/AnalysisService'
import { renderSummaryPdf } from '../services/pdf/SummaryPdfExporter'
import * as store from '../services/persistence/store'
import { buildAppMenu } from '../services/window/menu'
import {
  convertToPdf,
  needsConversion,
  SUPPORTED_EXTENSIONS
} from '../services/pdf/DocumentImporter'
import type { WindowManager } from '../services/window/WindowManager'

export function registerIpcHandlers(ai: AIProvider, windows: WindowManager): void {
  const engine = new LearningEngine(
    ai,
    async (projectId) => {
      const project = (await store.listProjects()).find((p) => p.id === projectId)
      return project?.summaryLevel ?? windows.getSettings().summaryLevel ?? 'standard'
    },
    async (projectId) => {
      const project = (await store.listProjects()).find((p) => p.id === projectId)
      return project?.summaryLanguage ?? windows.getSettings().language ?? 'ko'
    }
  )
  const activeRequests = new Map<string, AbortController>()
  const summaryAborts = new Map<string, AbortController>()

  // How many step summaries to generate at once. Bounded (rather than
  // unlimited) so each step still sees the previous BATCH's real output for
  // its "don't repeat the previous section" instruction — only steps within
  // the same batch lose that continuity signal, not the whole document.
  const SUMMARY_CONCURRENCY = 3

  /**
   * Pre-writes the summary document: one section per step lacking one, a
   * few steps at a time. Cancels any run already in progress for this
   * project first, so a "rebuild" click always starts clean instead of
   * being a no-op.
   */
  const ensureSummaries = async (projectId: string): Promise<void> => {
    summaryAborts.get(projectId)?.abort()
    const controller = new AbortController()
    summaryAborts.set(projectId, controller)
    try {
      const [plan, conversation] = await Promise.all([
        store.getPlan(projectId),
        store.getConversation(projectId)
      ])
      if (!plan) return
      const covered = new Set(
        conversation.filter((e) => e.role === 'assistant' && e.kind === 'study').map((e) => e.stepId)
      )
      const missing = plan.steps.filter((s) => !covered.has(s.id))
      if (missing.length === 0) return
      const total = plan.steps.length
      let done = total - missing.length

      for (let i = 0; i < missing.length; i += SUMMARY_CONCURRENCY) {
        if (controller.signal.aborted) return
        const batch = missing.slice(i, i + SUMMARY_CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map((step) => engine.generateStepSummary(projectId, step.id, controller.signal))
        )
        if (controller.signal.aborted) return
        for (const result of results) {
          if (result.status !== 'fulfilled') continue
          done++
          windows.broadcast(IPC.summaryAdded, { projectId, entry: result.value })
          windows.broadcast(IPC.summaryProgress, { projectId, done, total })
        }
        const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (failed) throw failed.reason
      }
      windows.broadcast(IPC.summaryProgress, { projectId, done: total, total })
    } catch (err) {
      if (controller.signal.aborted) return
      windows.broadcast(IPC.summaryProgress, {
        projectId,
        done: -1,
        total: -1,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      if (summaryAborts.get(projectId) === controller) summaryAborts.delete(projectId)
    }
  }

  // ---------- Claude CLI ----------

  ipcMain.handle(IPC.cliStatus, async () => {
    const { available, version } = await ai.checkAvailability()
    return { installed: available, version }
  })

  /** Conversion (if needed) + analysis + summary pre-generation, with progress. */
  const runProjectAnalysis = async (project: Project): Promise<void> => {
    const uiLang = windows.getSettings().language ?? 'ko'
    try {
      if (needsConversion(project.pdfPath)) {
        windows.broadcast(IPC.analysisProgress, {
          projectId: project.id,
          phase: 'reading-pdf',
          progress: 0.01,
          detail: uiLang === 'ko' ? 'PDF로 변환 중' : 'Converting to PDF'
        } satisfies AnalysisProgress)
        project.pdfPath = await convertToPdf(
          project.pdfPath,
          store.projectDir(project.id),
          uiLang
        )
        await store.upsertProject(project)
      }
      await analyzeProject(
        project,
        ai,
        (progress: AnalysisProgress) => windows.broadcast(IPC.analysisProgress, progress),
        project.summaryLanguage ?? uiLang
      )
      project.analysisStatus = 'done'
      // pre-write the whole summary document in the background
      void ensureSummaries(project.id)
    } catch (err) {
      project.analysisStatus = 'error'
      windows.broadcast(IPC.analysisProgress, {
        projectId: project.id,
        phase: 'error',
        progress: 0,
        detail: err instanceof Error ? err.message : String(err)
      } satisfies AnalysisProgress)
    }
    project.updatedAt = new Date().toISOString()
    await store.upsertProject(project)
  }

  // ---------- Projects ----------

  let menuProjects: Project[] = []
  windows.setSettingsChangedListener(() => buildAppMenu(windows, menuProjects))

  ipcMain.handle(IPC.projectList, async (): Promise<ProjectSummary[]> => {
    const projects = await store.listProjects()
    menuProjects = projects
    buildAppMenu(windows, projects) // keep the recent-projects menu fresh
    return Promise.all(
      projects.map(async (p) => {
        const [plan, session] = await Promise.all([store.getPlan(p.id), store.getSession(p.id)])
        const total = plan?.steps.length ?? 0
        const done = session?.completedStepIds.length ?? 0
        const current = plan?.steps.find((s) => s.id === session?.currentStepId)
        return {
          ...p,
          progress: total > 0 ? done / total : 0,
          totalSteps: total,
          currentStepTitle: current?.title ?? null
        }
      })
    )
  })

  ipcMain.handle(IPC.pickPdf, async () => {
    const result = await dialog.showOpenDialog({
      title: '문서 선택',
      filters: [
        { name: 'Documents', extensions: SUPPORTED_EXTENSIONS },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['docx', 'doc'] },
        { name: 'Pages', extensions: ['pages'] }
      ],
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(
    IPC.projectCreate,
    async (
      _e,
      {
        name,
        pdfPath,
        summaryLevel,
        summaryLanguage
      }: {
        name: string
        pdfPath: string
        summaryLevel?: Project['summaryLevel']
        summaryLanguage?: Project['summaryLanguage']
      }
    ): Promise<Project> => {
      const now = new Date().toISOString()
      const project: Project = {
        id: newId(10),
        name,
        pdfPath,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
        analysisStatus: 'analyzing',
        summaryLevel,
        summaryLanguage
      }
      await store.upsertProject(project)
      // long-running analysis runs async; progress streams to all windows
      void runProjectAnalysis(project)
      return project
    }
  )

  ipcMain.handle(IPC.projectRetryAnalysis, async (_e, id: string) => {
    const project = (await store.listProjects()).find((p) => p.id === id)
    if (!project) return null
    project.analysisStatus = 'analyzing'
    project.updatedAt = new Date().toISOString()
    await store.upsertProject(project)
    void runProjectAnalysis(project)
    return project
  })

  ipcMain.handle(IPC.projectDelete, (_e, id: string) => store.deleteProject(id))

  ipcMain.handle(
    IPC.projectSetSummaryLanguage,
    async (
      _e,
      { projectId, language }: { projectId: string; language: Project['summaryLanguage'] }
    ) => {
      const projects = await store.listProjects()
      const project = projects.find((p) => p.id === projectId)
      if (!project) return null
      project.summaryLanguage = language
      project.updatedAt = new Date().toISOString()
      await store.upsertProject(project)
      return project
    }
  )

  ipcMain.handle(
    IPC.projectSetSummaryLevel,
    async (_e, { projectId, level }: { projectId: string; level: Project['summaryLevel'] }) => {
      const projects = await store.listProjects()
      const project = projects.find((p) => p.id === projectId)
      if (!project) return null
      project.summaryLevel = level
      project.updatedAt = new Date().toISOString()
      await store.upsertProject(project)
      return project
    }
  )

  ipcMain.handle(IPC.projectOpen, async (_e, id: string) => {
    const projects = await store.listProjects()
    const project = projects.find((p) => p.id === id)
    if (project) {
      project.lastOpenedAt = new Date().toISOString()
      await store.upsertProject(project)
      // legacy or interrupted projects: fill in missing summary sections
      if (project.analysisStatus === 'done') void ensureSummaries(id)
    }
    return project ?? null
  })

  // ---------- Project data ----------

  ipcMain.handle(IPC.getAnalysis, (_e, id: string) => store.getAnalysis(id))
  ipcMain.handle(IPC.getPlan, (_e, id: string) => store.getPlan(id))
  ipcMain.handle(IPC.getSession, (_e, id: string) => store.getSession(id))
  ipcMain.handle(IPC.getConversation, (_e, id: string) => store.getConversation(id))
  ipcMain.handle(IPC.clearConversation, (_e, id: string) => store.saveConversation(id, []))
  ipcMain.handle(IPC.readPdf, async (_e, pdfPath: string) => {
    const buf = await fs.readFile(pdfPath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  ipcMain.handle(
    IPC.exportSummaryPdf,
    async (_e, { title, html }: ExportSummaryPdfRequest): Promise<ExportSummaryPdfResult> => {
      const uiLang = windows.getSettings().language ?? 'ko'
      const result = await dialog.showSaveDialog({
        title: uiLang === 'ko' ? 'PDF로 내보내기' : 'Export as PDF',
        defaultPath: `${title || 'summary'}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      try {
        const buffer = await renderSummaryPdf(title, html)
        await fs.writeFile(result.filePath, buffer)
        return { canceled: false, filePath: result.filePath }
      } catch (err) {
        return { canceled: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ---------- Learning ----------

  const runAsk = (projectId: string, question: string, requestId: string): void => {
    const controller = new AbortController()
    activeRequests.set(requestId, controller)
    engine
      .ask(projectId, question, {
        signal: controller.signal,
        onChunk: (text: string) => windows.broadcast(IPC.aiChunk, { requestId, text })
      })
      .then((result) => {
        windows.broadcast(IPC.aiDone, {
          requestId,
          fullText: result.visibleText,
          sessionUpdate: result.sessionUpdate
        } satisfies AIStreamDone)
      })
      .catch((err) => {
        windows.broadcast(IPC.aiDone, {
          requestId,
          fullText: '',
          error: err instanceof Error ? err.message : String(err)
        } satisfies AIStreamDone)
      })
      .finally(() => activeRequests.delete(requestId))
  }

  ipcMain.handle(
    IPC.askQuestion,
    (_e, { projectId, question }: { projectId: string; question: string }) => {
      const requestId = newId(10)
      runAsk(projectId, question, requestId)
      return requestId
    }
  )

  ipcMain.handle(IPC.ensureSummaries, (_e, projectId: string) => {
    void ensureSummaries(projectId)
  })

  ipcMain.handle(IPC.regeneratePlan, async (_e, projectId: string) => {
    const project = (await store.listProjects()).find((p) => p.id === projectId)
    const plan = await store.getPlan(projectId)
    if (!project || !plan) return null
    const lang = project.summaryLanguage ?? windows.getSettings().language ?? 'ko'
    const relocalized = await relocalizePlan(project, plan, ai, lang)
    await store.savePlan(projectId, relocalized)
    return relocalized
  })

  ipcMain.handle(
    IPC.mergeSupplements,
    async (_e, { projectId, stepId }: { projectId: string; stepId: string }) => {
      const conversation = await engine.mergeStepSupplements(projectId, stepId)
      windows.broadcast(IPC.conversationReplaced, { projectId, conversation })
      return conversation
    }
  )

  ipcMain.handle(
    IPC.regenerateStepSummary,
    async (_e, { projectId, stepId }: { projectId: string; stepId: string }) => {
      const conversation = await engine.regenerateStepSummary(projectId, stepId)
      windows.broadcast(IPC.conversationReplaced, { projectId, conversation })
      return conversation
    }
  )

  ipcMain.handle(IPC.cancelRequest, (_e, requestId: string) => {
    activeRequests.get(requestId)?.abort()
    activeRequests.delete(requestId)
  })

  ipcMain.handle(
    IPC.updateSession,
    async (_e, { projectId, patch }: { projectId: string; patch: Partial<LearningSession> }) => {
      const session = await store.getSession(projectId)
      if (!session) return null
      Object.assign(session, patch, { updatedAt: new Date().toISOString() })
      await store.saveSession(projectId, session)
      windows.broadcast(IPC.sessionChanged, { projectId, session })
      return session
    }
  )

  // ---------- Window / settings ----------

  ipcMain.handle(IPC.getSettings, () => windows.getSettings())
  ipcMain.handle(
    IPC.setWindowMode,
    (_e, { mode, projectId }: { mode: WindowMode; projectId?: string }) =>
      windows.setWindowMode(
        mode,
        projectId ? { type: 'open-project', projectId } : undefined
      )
  )
  ipcMain.handle(IPC.setSplitRatio, (_e, ratio: number) => windows.setSplitRatio(ratio))
  ipcMain.handle(IPC.newWindow, () => windows.newMainWindow())
  ipcMain.handle(IPC.setTheme, (_e, theme: 'system' | 'light' | 'dark') =>
    windows.setTheme(theme)
  )
  ipcMain.handle(IPC.setSummaryLevel, (_e, level: 'brief' | 'standard' | 'detailed') =>
    windows.setSummaryLevel(level)
  )
  ipcMain.handle(IPC.setLanguage, (_e, language: 'ko' | 'en') => windows.setLanguage(language))
  ipcMain.handle(IPC.setAiModel, (_e, model: 'default' | 'sonnet' | 'opus' | 'fable') =>
    windows.setAiModel(model)
  )
  ipcMain.handle(IPC.pendingAction, () => windows.takePendingAction())
  ipcMain.on(IPC.reportScreen, (event, screen: string) =>
    windows.setScreenFor(event.sender, screen)
  )

  // ---------- Cross-window sync ----------

  ipcMain.on(IPC.syncBroadcast, (event, state: SyncState) => {
    windows.broadcast(IPC.syncState, state, event.sender.id)
  })
}
