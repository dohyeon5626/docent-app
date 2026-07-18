// ---------- Project ----------

export interface Project {
  id: string
  name: string
  pdfPath: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
  analysisStatus: 'pending' | 'analyzing' | 'done' | 'error'
  /** per-project summary detail (falls back to the app default) */
  summaryLevel?: SummaryLevel
  /** per-project summary language (falls back to the app language) */
  summaryLanguage?: AppLanguage
}

export interface ProjectSummary extends Project {
  progress: number // 0..1
  currentStepTitle: string | null
  totalSteps: number
}

// ---------- PDF Analysis ----------

export interface PageText {
  page: number
  text: string
}

export interface Chapter {
  title: string
  startPage: number
  endPage: number
}

export interface Concept {
  name: string
  description: string
  pages: number[]
  difficulty: 'easy' | 'medium' | 'hard'
  prerequisites: string[]
}

export interface Analysis {
  totalPages: number
  toc: { title: string; page: number; level: number }[]
  chapters: Chapter[]
  keywords: string[]
  concepts: Concept[]
  summary: string
}

export type AnalysisPhase =
  | 'reading-pdf'
  | 'extracting-text'
  | 'parsing-pages'
  | 'detecting-chapters'
  | 'extracting-concepts'
  | 'creating-learning-plan'
  | 'done'
  | 'error'

export interface AnalysisProgress {
  projectId: string
  phase: AnalysisPhase
  progress: number // 0..1 overall
  detail?: string
}

// ---------- Learning Plan ----------

export interface LearningStep {
  id: string
  title: string
  description: string
  concepts: string[]
  pages: number[]
  status: 'pending' | 'in-progress' | 'completed'
}

export interface LearningPlan {
  goal: string
  steps: LearningStep[]
}

// ---------- Learning Session ----------

export interface LearningSession {
  currentStepId: string | null
  currentPage: number
  completedStepIds: string[]
  weakConcepts: string[]
  strongConcepts: string[]
  recommendedNextStepId: string | null
  learningGoal: string
  updatedAt: string
  /** reading position in the summary document, 0..1 (persists across windows) */
  readCurrentRatio?: number
  /** furthest position ever read, 0..1 */
  readMaxRatio?: number
}

// ---------- Conversation ----------

export interface ConversationEntry {
  id: string
  role: 'user' | 'assistant'
  kind: 'study' | 'question' | 'answer'
  stepId: string | null
  text: string
  createdAt: string
}

// ---------- AI streaming ----------

export interface AIStreamChunk {
  requestId: string
  text: string
}

export interface SessionUpdatePayload {
  session: LearningSession
  plan: LearningPlan
}

export interface AIStreamDone {
  requestId: string
  fullText: string
  error?: string
  sessionUpdate?: SessionUpdatePayload
}

// ---------- Window / Settings ----------

export type WindowMode = 'split' | 'separate'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export type ThemePreference = 'system' | 'light' | 'dark'

/** how condensed the generated summaries are */
export type SummaryLevel = 'brief' | 'standard' | 'detailed'

/** UI + generated-summary language */
export type AppLanguage = 'ko' | 'en'

export interface AppSettings {
  windowMode: WindowMode
  splitRatio: number // 0..1, left pane width fraction
  windows: Partial<Record<'main' | 'pdf' | 'study', WindowBounds>>
  theme?: ThemePreference
  /** default summary detail for new projects */
  summaryLevel?: SummaryLevel
  language?: AppLanguage
  /** AI backend id (only 'claude' is implemented today) */
  aiProvider?: string
  /** Claude model alias passed to the CLI ('default' = CLI's own setting) */
  aiModel?: 'default' | 'sonnet' | 'opus' | 'fable'
}

// ---------- Claude CLI ----------

export interface CliStatus {
  installed: boolean
  version: string | null
}

// ---------- Cross-window sync ----------

export interface HighlightRequest {
  page: number
  query: string
  nonce: number
}

export interface SyncState {
  projectId: string | null
  currentPage: number
  highlight?: HighlightRequest
  /** scroll the study document to this step's section */
  reveal?: { stepId: string; nonce: number }
}

// ---------- Summary generation ----------

export interface SummaryProgress {
  projectId: string
  done: number
  total: number
}

// ---------- Summary export ----------

export interface ExportSummaryPdfRequest {
  projectId: string
  title: string
  html: string
}

export interface ExportSummaryPdfResult {
  canceled: boolean
  filePath?: string
  error?: string
}

// ---------- Menu ----------

export interface MenuAction {
  type: 'home' | 'create' | 'open-project'
  projectId?: string
}
