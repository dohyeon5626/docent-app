// IPC channel names shared between main / preload / renderer.

export const IPC = {
  // Claude CLI
  cliStatus: 'cli:status',

  // Projects
  projectList: 'project:list',
  projectCreate: 'project:create',
  projectDelete: 'project:delete',
  projectOpen: 'project:open',
  projectSetSummaryLevel: 'project:set-summary-level',
  projectSetSummaryLanguage: 'project:set-summary-language',
  projectRetryAnalysis: 'project:retry-analysis',
  pickPdf: 'project:pick-pdf',

  // Analysis
  analysisProgress: 'analysis:progress', // main -> renderer event

  // Project data
  getAnalysis: 'data:get-analysis',
  getPlan: 'data:get-plan',
  getSession: 'data:get-session',
  getConversation: 'data:get-conversation',
  clearConversation: 'data:clear-conversation',
  readPdf: 'data:read-pdf',
  exportSummaryPdf: 'data:export-summary-pdf',

  // Learning
  askQuestion: 'learn:ask',
  cancelRequest: 'learn:cancel',
  updateSession: 'learn:update-session',
  ensureSummaries: 'learn:ensure-summaries',
  regeneratePlan: 'learn:regenerate-plan',
  mergeSupplements: 'learn:merge-supplements',
  conversationReplaced: 'learn:conversation-replaced', // main -> renderer event
  aiChunk: 'learn:ai-chunk', // main -> renderer event
  aiDone: 'learn:ai-done', // main -> renderer event
  sessionChanged: 'learn:session-changed', // main -> renderer event
  summaryAdded: 'learn:summary-added', // main -> renderer event
  summaryProgress: 'learn:summary-progress', // main -> renderer event

  // Window / settings
  getSettings: 'window:get-settings',
  setWindowMode: 'window:set-mode',
  setSplitRatio: 'window:set-split-ratio',
  newWindow: 'window:new',
  setTheme: 'window:set-theme',
  setSummaryLevel: 'window:set-summary-level',
  setLanguage: 'window:set-language',
  setAiModel: 'window:set-ai-model',
  settingsChanged: 'window:settings-changed', // main -> renderer event
  frameState: 'window:frame-state', // main -> renderer event
  pendingAction: 'window:pending-action',
  reportScreen: 'window:report-screen', // renderer -> main, fire-and-forget
  menuAction: 'menu:action', // main -> renderer event

  // Cross-window sync
  syncBroadcast: 'sync:broadcast', // renderer -> main -> other renderers
  syncState: 'sync:state' // main -> renderer event
} as const
