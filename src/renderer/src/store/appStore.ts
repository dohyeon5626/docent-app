import { create } from 'zustand'
import { newId } from '@shared/id'
import type {
  Analysis,
  AppLanguage,
  SummaryLevel,
  AnalysisProgress,
  AppSettings,
  CliStatus,
  ConversationEntry,
  HighlightRequest,
  LearningPlan,
  LearningSession,
  Project,
  ProjectSummary
} from '@shared/types'

export type Screen = 'loading' | 'setup' | 'projects' | 'create' | 'main'

/** Which pane this window shows: split-mode window shows both. */
export type PaneRole = 'both' | 'pdf' | 'study'

export function getPaneRole(): PaneRole {
  const hash = window.location.hash
  if (hash.startsWith('#/pdf')) return 'pdf'
  if (hash.startsWith('#/study')) return 'study'
  return 'both'
}

interface StreamingMessage {
  requestId: string
  text: string
  /** index of the last [페이지 N] ref already applied to the viewer */
  lastRefIndex: number
  /** the step the answer belongs to (pinned at ask time) */
  stepId: string | null
}

interface AppState {
  screen: Screen
  paneRole: PaneRole
  cli: CliStatus | null
  settings: AppSettings | null

  projects: ProjectSummary[]
  createProgress: AnalysisProgress | null

  activeProject: Project | null
  analysis: Analysis | null
  plan: LearningPlan | null
  session: LearningSession | null
  conversation: ConversationEntry[]
  streaming: StreamingMessage | null
  aiError: string | null
  lastRequest: { kind: 'step' | 'ask'; arg: string } | null

  currentPage: number
  highlightRequest: HighlightRequest | null
  revealTarget: { stepId: string; nonce: number } | null
  summaryProgress: { done: number; total: number } | null
  summaryError: string | null
  retrySummaries: () => Promise<void>
  retryAnalysis: (id: string) => Promise<void>

  init: () => Promise<void>
  recheckCli: () => Promise<void>
  loadProjects: () => Promise<void>
  goToCreate: () => void
  goToProjects: () => void
  createProject: (
    name: string,
    pdfPath: string,
    level?: SummaryLevel,
    language?: AppLanguage
  ) => Promise<void>
  setProjectSummaryLanguage: (language: AppLanguage) => Promise<void>
  setProjectSummaryLevel: (level: SummaryLevel) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  openProject: (id: string, opts?: { fromSync?: boolean }) => Promise<void>
  restartLearning: () => Promise<void>
  ask: (question: string) => Promise<void>
  retryLast: () => Promise<void>
  cancelStreaming: () => Promise<void>
  /** fold a step's Q&A into its summary section */
  mergeSupplements: (stepId: string) => Promise<void>
  mergingStepId: string | null
  /** regenerate a single section's summary in place */
  regenerateSection: (stepId: string) => Promise<void>
  regeneratingStepId: string | null
  /** current question/answer shown in the fixed panel above the input */
  qaPanel: {
    question: string
    answer: string
    stepId: string | null
    status: 'streaming' | 'done' | 'error'
  } | null
  closeQaPanel: () => void
  /** the learner scrolled to a different step section */
  reportReadingStep: (stepId: string) => void
  /** scroll the study document to a step (e.g. from a PDF click) */
  revealStep: (stepId: string, opts?: { fromSync?: boolean }) => void
  /** fromAi: persist as the study position; fromSync: don't re-broadcast;
   *  highlight: flash the matching region on the target page */
  setPage: (
    page: number,
    opts?: { fromSync?: boolean; fromAi?: boolean; highlight?: string }
  ) => void
  setSplitRatio: (ratio: number) => void
  setWindowMode: (mode: AppSettings['windowMode']) => Promise<void>
}

const PAGE_REF = /\[(?:페이지|page)\s*(\d+)\]/gi

/** Finds the last complete [페이지 N] reference and its position in the text. */
function lastPageRef(text: string): { page: number; index: number } | null {
  let match: RegExpExecArray | null
  let found: { page: number; index: number } | null = null
  PAGE_REF.lastIndex = 0
  while ((match = PAGE_REF.exec(text))) found = { page: Number(match[1]), index: match.index }
  return found
}

export const useAppStore = create<AppState>((set, get) => {
  let listenersBound = false

  const bindListeners = (): void => {
    if (listenersBound) return
    listenersBound = true

    window.api.onAnalysisProgress((p) => {
      set({ createProgress: p })
      if (p.phase === 'done' || p.phase === 'error') void get().loadProjects()
    })

    window.api.onAiChunk(({ requestId, text }) => {
      const { streaming } = get()
      if (!streaming || streaming.requestId !== requestId) return
      const newText = streaming.text + text
      // auto-jump when a new [페이지 N] reference streams in
      const ref = lastPageRef(newText)
      const isNewRef = ref !== null && ref.index > streaming.lastRefIndex
      const { qaPanel } = get()
      set({
        streaming: {
          ...streaming,
          text: newText,
          lastRefIndex: isNewRef ? ref.index : streaming.lastRefIndex
        },
        ...(qaPanel && qaPanel.status === 'streaming'
          ? { qaPanel: { ...qaPanel, answer: newText } }
          : {})
      })
      if (isNewRef) get().setPage(ref.page, { fromAi: true })
    })

    window.api.onAiDone(({ requestId, fullText, error, sessionUpdate }) => {
      const { streaming, conversation, session, qaPanel } = get()
      if (streaming && streaming.requestId !== requestId) return
      if (error) {
        set({
          streaming: null,
          aiError: error,
          ...(qaPanel ? { qaPanel: { ...qaPanel, status: 'error' as const } } : {})
        })
        return
      }
      if (qaPanel) set({ qaPanel: { ...qaPanel, answer: fullText, status: 'done' } })
      const entry: ConversationEntry = {
        id: newId(10),
        role: 'assistant',
        kind: 'answer',
        stepId:
          streaming?.stepId ??
          sessionUpdate?.session.currentStepId ??
          session?.currentStepId ??
          null,
        text: fullText,
        createdAt: new Date().toISOString()
      }
      set({
        streaming: null,
        aiError: null,
        conversation: [...conversation, entry],
        ...(sessionUpdate ? { session: sessionUpdate.session, plan: sessionUpdate.plan } : {})
      })
      // fallback: land on the page the final text (or session) points at
      const ref = lastPageRef(fullText)
      if (ref) get().setPage(ref.page, { fromSync: true })
      else if (sessionUpdate?.session.currentPage)
        get().setPage(sessionUpdate.session.currentPage, { fromSync: true })
    })

    window.api.onSessionChanged(({ projectId, session }) => {
      if (get().activeProject?.id === projectId) set({ session })
    })

    window.api.onSyncState((state) => {
      const { activeProject, paneRole } = get()
      if (state.projectId && state.projectId !== activeProject?.id) {
        // only companion pane windows follow project changes; independent
        // main windows keep whatever they have open
        if (paneRole !== 'both') void get().openProject(state.projectId, { fromSync: true })
      } else if (state.projectId === activeProject?.id) {
        get().setPage(state.currentPage, { fromSync: true })
        if (state.highlight) set({ highlightRequest: state.highlight })
        if (state.reveal) set({ revealTarget: state.reveal })
      }
    })

    window.api.onMenuAction((action) => {
      if (get().paneRole !== 'both' && action.type !== 'open-project') return
      if (action.type === 'home') get().goToProjects()
      else if (action.type === 'create') set({ screen: 'create', createProgress: null })
      else if (action.type === 'open-project' && action.projectId)
        void get().openProject(action.projectId)
    })

    window.api.onSummaryAdded(({ projectId, entry }) => {
      const { activeProject, conversation } = get()
      if (activeProject?.id !== projectId) return
      if (conversation.some((e) => e.id === entry.id)) return
      set({ conversation: [...conversation, entry] })
    })

    window.api.onSummaryProgress((p) => {
      if (get().activeProject?.id !== p.projectId) return
      if (p.done < 0) set({ summaryProgress: null, summaryError: p.error ?? 'error' })
      else if (p.done >= p.total) set({ summaryProgress: null, summaryError: null })
      else set({ summaryProgress: { done: p.done, total: p.total }, summaryError: null })
    })

    window.api.onConversationReplaced(({ projectId, conversation }) => {
      if (get().activeProject?.id === projectId) set({ conversation })
    })

    window.api.onSettingsChanged((settings) => set({ settings }))

    window.api.onFrameState(({ square }) => {
      document.documentElement.dataset.square = square ? '1' : ''
    })
  }

  return {
    screen: 'loading',
    paneRole: 'both',
    cli: null,
    settings: null,
    projects: [],
    createProgress: null,
    activeProject: null,
    analysis: null,
    plan: null,
    session: null,
    conversation: [],
    streaming: null,
    aiError: null,
    lastRequest: null,
    currentPage: 1,
    highlightRequest: null,
    revealTarget: null,
    summaryProgress: null,
    summaryError: null,

    init: async () => {
      bindListeners()
      const role = getPaneRole()
      set({ paneRole: role })
      // the CSS window-corner painting is scoped to the frameless main window
      document.documentElement.dataset.pane = role
      const [cli, settings] = await Promise.all([window.api.cliStatus(), window.api.getSettings()])
      set({ cli, settings })
      if (!cli.installed) {
        set({ screen: 'setup' })
        return
      }
      await get().loadProjects()
      set({ screen: 'projects' })
      // pane windows: re-open the most recently studied project automatically
      if (get().paneRole !== 'both') {
        const recent = get()
          .projects.filter((p) => p.analysisStatus === 'done' && p.lastOpenedAt)
          .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0]
        if (recent) void get().openProject(recent.id, { fromSync: true })
        return
      }
      // apply an action queued across a window-mode switch (menu navigation)
      const pending = await window.api.takePendingAction()
      if (pending?.type === 'create') set({ screen: 'create', createProgress: null })
      else if (pending?.type === 'open-project' && pending.projectId)
        void get().openProject(pending.projectId)
    },

    recheckCli: async () => {
      const cli = await window.api.cliStatus()
      set({ cli })
      if (cli.installed) {
        await get().loadProjects()
        set({ screen: 'projects' })
      }
    },

    loadProjects: async () => {
      set({ projects: await window.api.listProjects() })
    },

    goToCreate: () => set({ screen: 'create', createProgress: null }),
    goToProjects: () => {
      void get().loadProjects()
      set({
        screen: 'projects',
        activeProject: null,
        analysis: null,
        plan: null,
        session: null,
        conversation: [],
        streaming: null
      })
    },

    createProject: async (name, pdfPath, level, language) => {
      const project = await window.api.createProject(name, pdfPath, level, language)
      set({
        createProgress: { projectId: project.id, phase: 'reading-pdf', progress: 0 }
      })
    },

    retrySummaries: async () => {
      const { activeProject } = get()
      if (!activeProject) return
      set({ summaryError: null })
      await window.api.ensureSummaries(activeProject.id)
    },

    retryAnalysis: async (id) => {
      await window.api.retryAnalysis(id)
      await get().loadProjects()
    },

    setProjectSummaryLanguage: async (language) => {
      const { activeProject } = get()
      if (!activeProject) return
      const updated = await window.api.setProjectSummaryLanguage(activeProject.id, language)
      if (updated) set({ activeProject: updated })
    },

    setProjectSummaryLevel: async (level) => {
      const { activeProject } = get()
      if (!activeProject) return
      const updated = await window.api.setProjectSummaryLevel(activeProject.id, level)
      if (updated) set({ activeProject: updated })
    },

    deleteProject: async (id) => {
      await window.api.deleteProject(id)
      await get().loadProjects()
    },

    openProject: async (id, opts = {}) => {
      const project = await window.api.openProject(id)
      if (!project) return
      const [analysis, plan, session, conversation] = await Promise.all([
        window.api.getAnalysis(id),
        window.api.getPlan(id),
        window.api.getSession(id),
        window.api.getConversation(id)
      ])
      // one window leads the session (the study window in separate mode);
      // the PDF window follows silently and never auto-starts
      const leads = get().paneRole !== 'pdf'
      set({
        screen: 'main',
        activeProject: project,
        analysis,
        plan,
        session,
        conversation,
        streaming: null,
        aiError: null,
        currentPage: session?.currentPage ?? 1,
        highlightRequest: null,
        revealTarget: null,
        summaryProgress: null,
        summaryError: null
      })
      void leads
      if (!opts.fromSync) {
        window.api.broadcastSync({ projectId: id, currentPage: session?.currentPage ?? 1 })
      }
    },

    restartLearning: async () => {
      const { activeProject, plan } = get()
      if (!activeProject || !plan?.steps[0]) return
      // show feedback immediately — the plan relocalization call below can
      // take a while and summaryProgress otherwise stays null until
      // ensureSummaries starts, which looks like the UI froze at the start
      set({ summaryProgress: { done: 0, total: plan.steps.length }, summaryError: null })
      await window.api.clearConversation(activeProject.id)
      // re-localize the table of contents (plan goal/step titles) into the
      // current summary language before regenerating the step summaries
      let effectivePlan = plan
      try {
        effectivePlan = (await window.api.regeneratePlan(activeProject.id)) ?? plan
      } catch (err) {
        set({
          summaryProgress: null,
          summaryError: err instanceof Error ? err.message : String(err)
        })
        return
      }
      const session = await window.api.updateSession(activeProject.id, {
        currentStepId: effectivePlan.steps[0].id,
        currentPage: effectivePlan.steps[0].pages[0] ?? 1,
        completedStepIds: [],
        weakConcepts: [],
        strongConcepts: [],
        readCurrentRatio: 0,
        readMaxRatio: 0
      })
      if (session) set({ session, currentPage: session.currentPage })
      set({ conversation: [], revealTarget: null, plan: effectivePlan })
      // regenerate the whole summary document
      await window.api.ensureSummaries(activeProject.id)
    },

    ask: async (question) => {
      const { activeProject, streaming, conversation, session } = get()
      if (!activeProject || streaming || !question.trim()) return
      const entry: ConversationEntry = {
        id: newId(10),
        role: 'user',
        kind: 'question',
        stepId: session?.currentStepId ?? null,
        text: question,
        createdAt: new Date().toISOString()
      }
      set({ conversation: [...conversation, entry] })
      const requestId = await window.api.askQuestion(activeProject.id, question)
      set({
        streaming: {
          requestId,
          text: '',
          lastRefIndex: -1,
          stepId: session?.currentStepId ?? null
        },
        aiError: null,
        lastRequest: { kind: 'ask', arg: question },
        qaPanel: {
          question,
          answer: '',
          stepId: session?.currentStepId ?? null,
          status: 'streaming'
        }
      })
    },

    retryLast: async () => {
      const { activeProject, lastRequest, streaming, session } = get()
      if (!activeProject || !lastRequest || streaming) return
      set({ aiError: null })
      const requestId = await window.api.askQuestion(activeProject.id, lastRequest.arg)
      set({
        streaming: {
          requestId,
          text: '',
          lastRefIndex: -1,
          stepId: session?.currentStepId ?? null
        },
        qaPanel: {
          question: lastRequest.arg,
          answer: '',
          stepId: session?.currentStepId ?? null,
          status: 'streaming'
        }
      })
    },

    reportReadingStep: (stepId) => {
      const { activeProject, session, plan } = get()
      if (!activeProject || !plan || session?.currentStepId === stepId) return
      const idx = plan.steps.findIndex((s) => s.id === stepId)
      if (idx < 0) return
      // steps above the reading position count as completed
      const completedStepIds = plan.steps.slice(0, idx).map((s) => s.id)
      void window.api.updateSession(activeProject.id, { currentStepId: stepId, completedStepIds })
    },

    revealStep: (stepId, opts = {}) => {
      const { activeProject, currentPage } = get()
      set({ revealTarget: { stepId, nonce: Date.now() } })
      if (!opts.fromSync && activeProject) {
        window.api.broadcastSync({
          projectId: activeProject.id,
          currentPage,
          reveal: { stepId, nonce: Date.now() }
        })
      }
    },

    cancelStreaming: async () => {
      const { streaming } = get()
      if (!streaming) return
      await window.api.cancelRequest(streaming.requestId)
      set({ streaming: null })
    },

    mergingStepId: null,
    qaPanel: null,
    closeQaPanel: () => set({ qaPanel: null, aiError: null }),
    mergeSupplements: async (stepId) => {
      const { activeProject, mergingStepId, streaming } = get()
      if (!activeProject || mergingStepId || streaming) return
      set({ mergingStepId: stepId })
      try {
        const conversation = await window.api.mergeSupplements(activeProject.id, stepId)
        set({ conversation, qaPanel: null })
        // show the learner where the content landed
        get().revealStep(stepId)
      } catch (err) {
        set({ aiError: err instanceof Error ? err.message : String(err) })
      } finally {
        set({ mergingStepId: null })
      }
    },

    regeneratingStepId: null,
    regenerateSection: async (stepId) => {
      const { activeProject, regeneratingStepId, mergingStepId, streaming } = get()
      if (!activeProject || regeneratingStepId || mergingStepId || streaming) return
      set({ regeneratingStepId: stepId })
      try {
        const conversation = await window.api.regenerateStepSummary(activeProject.id, stepId)
        set({ conversation })
      } catch (err) {
        set({ aiError: err instanceof Error ? err.message : String(err) })
      } finally {
        set({ regeneratingStepId: null })
      }
    },

    setPage: (page, opts = {}) => {
      const { activeProject, currentPage } = get()
      if (page < 1) return
      const highlight = opts.highlight
        ? { page, query: opts.highlight, nonce: Date.now() }
        : undefined
      if (page !== currentPage || highlight) {
        set({ currentPage: page, ...(highlight ? { highlightRequest: highlight } : {}) })
        if (!opts.fromSync && activeProject) {
          window.api.broadcastSync({
            projectId: activeProject.id,
            currentPage: page,
            highlight
          })
        }
      }
      // only AI-driven navigation moves the saved study position; the user is
      // free to browse the PDF without losing their place
      if (opts.fromAi && activeProject) {
        void window.api.updateSession(activeProject.id, { currentPage: page })
      }
    },

    setSplitRatio: (ratio) => {
      const { settings } = get()
      if (settings) set({ settings: { ...settings, splitRatio: ratio } })
      void window.api.setSplitRatio(ratio)
    },

    setWindowMode: async (mode) => {
      // carry the open project across the window-mode switch
      await window.api.setWindowMode(mode, get().activeProject?.id)
    }
  }
})

// the main process tracks each window's screen to decide close behaviour
useAppStore.subscribe((state, prev) => {
  if (state.screen !== prev.screen) window.api.reportScreen(state.screen)
})
