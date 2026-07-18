import { newId } from '@shared/id'
import type {
  Analysis,
  AppLanguage,
  AnalysisProgress,
  LearningPlan,
  LearningSession,
  PageText,
  Project
} from '@shared/types'
import type { AIProvider } from '../claude/AIProvider'
import * as store from '../persistence/store'
import { extractPdf } from './PdfTextExtractor'

/** Parses JSON out of a model response, tolerating code fences and prose. */
export function parseModelJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.search(/[[{]/)
  if (start < 0) throw new Error('응답에서 JSON을 찾을 수 없습니다')
  for (let end = candidate.length; end > start; end--) {
    try {
      return JSON.parse(candidate.slice(start, end)) as T
    } catch {
      // keep trimming trailing junk
    }
  }
  throw new Error('응답 JSON 파싱 실패')
}

/** Condenses page texts so the whole document fits in one prompt. */
export function condensePages(pages: PageText[], totalBudget = 60000): string {
  const nonEmpty = pages.filter((p) => p.text)
  if (nonEmpty.length === 0) return '(no text)'
  const perPage = Math.max(200, Math.floor(totalBudget / nonEmpty.length))
  return nonEmpty
    .map((p) => `[p.${p.page}] ${p.text.slice(0, perPage)}`)
    .join('\n')
    .slice(0, totalBudget)
}

const LANG_NAME: Record<AppLanguage, string> = { ko: 'Korean', en: 'English' }

const DETAIL: Record<AppLanguage, { analyzing: string; planning: string; pages: string }> = {
  ko: {
    analyzing: 'Claude가 문서를 분석하고 있습니다',
    planning: 'Claude가 학습 계획을 만들고 있습니다',
    pages: '{n}/{total} 페이지'
  },
  en: {
    analyzing: 'Claude is analyzing the document',
    planning: 'Claude is drafting the learning plan',
    pages: 'page {n}/{total}'
  }
}

const analysisPrompt = (
  name: string,
  condensed: string,
  outline: string,
  lang: AppLanguage
): string => `
You are an expert at analyzing study documents. Analyze the per-page text of the PDF "${name}" below and output JSON only.

Document outline (if any):
${outline || '(none)'}

Per-page text ([p.N] marks the page number):
${condensed}

Output ONLY JSON matching this schema — no prose, nothing outside the JSON. All human-readable strings (summary, titles, names, descriptions) must be written in ${LANG_NAME[lang]}:
{
  "summary": "2-3 sentence summary of the whole document",
  "toc": [{"title": "...", "page": 1, "level": 0}],
  "chapters": [{"title": "...", "startPage": 1, "endPage": 10}],
  "keywords": ["..."],
  "concepts": [{
    "name": "concept name",
    "description": "one-line description",
    "pages": [3, 4],
    "difficulty": "easy|medium|hard",
    "prerequisites": ["prerequisite concept names"]
  }]
}
Extract 8–20 core concepts; "pages" must be the actual pages where each concept appears.`

const planPrompt = (name: string, analysisJson: string, lang: AppLanguage): string => `
You are a world-class personal tutor. Below is the analysis of the PDF "${name}".

${analysisJson}

Create a learning plan for someone studying this document for the first time.
Important: order the steps by "easiest to understand first", not by page order. Prerequisite concepts must come before the concepts that need them.

Output ONLY JSON matching this schema. All titles/descriptions in ${LANG_NAME[lang]}:
{
  "goal": "one-sentence learning goal for this document",
  "steps": [{
    "title": "step title",
    "description": "1-2 sentences on what this step covers",
    "concepts": ["concept names covered"],
    "pages": [related page numbers]
  }]
}
4–10 steps is appropriate.`

const planRelocalizePrompt = (
  name: string,
  goal: string,
  steps: { title: string; description: string }[],
  lang: AppLanguage
): string => `
You are localizing an existing learning plan for the document "${name}" into ${LANG_NAME[lang]}.

Rewrite the goal and each step's title/description in natural ${LANG_NAME[lang]}, preserving their meaning exactly. Do not add, remove, merge, split, or reorder steps — output exactly ${steps.length} step entries, in the same order as given.

Goal: ${goal}
Steps:
${steps.map((s, i) => `${i + 1}. ${s.title} — ${s.description}`).join('\n')}

Output ONLY JSON, no prose:
{"goal": "...", "steps": [{"title": "...", "description": "..."}]}`

export type ProgressCallback = (progress: AnalysisProgress) => void

/**
 * Re-localizes an already-generated plan's goal/step titles into a new
 * language, keeping step ids/concepts/pages/status untouched so session
 * progress and per-step summaries keyed by stepId stay valid.
 */
export async function relocalizePlan(
  project: Project,
  plan: LearningPlan,
  ai: AIProvider,
  lang: AppLanguage
): Promise<LearningPlan> {
  const raw = await ai.complete(
    planRelocalizePrompt(
      project.name,
      plan.goal,
      plan.steps.map((s) => ({ title: s.title, description: s.description })),
      lang
    )
  )
  const parsed = parseModelJson<{ goal: string; steps: { title: string; description: string }[] }>(
    raw
  )
  return {
    goal: parsed.goal ?? plan.goal,
    steps: plan.steps.map((step, i) => ({
      ...step,
      title: parsed.steps?.[i]?.title ?? step.title,
      description: parsed.steps?.[i]?.description ?? step.description
    }))
  }
}

/**
 * Full analysis pipeline for a newly created project:
 * extract text -> detect structure -> Claude analysis -> Claude learning plan.
 * All results are persisted locally so the PDF never has to be re-analyzed.
 */
export async function analyzeProject(
  project: Project,
  ai: AIProvider,
  onProgress: ProgressCallback,
  language: AppLanguage = 'ko'
): Promise<void> {
  const emit = (phase: AnalysisProgress['phase'], progress: number, detail?: string): void =>
    onProgress({ projectId: project.id, phase, progress, detail })

  emit('reading-pdf', 0.02)
  const detail = DETAIL[language]
  const extracted = await extractPdf(project.pdfPath, (page, total) =>
    emit(
      'extracting-text',
      0.05 + 0.3 * (page / total),
      detail.pages.replace('{n}', String(page)).replace('{total}', String(total))
    )
  )
  await store.savePageTexts(project.id, extracted.pages)

  emit('parsing-pages', 0.38)
  const condensed = condensePages(extracted.pages)
  const outlineText = extracted.outline
    .map((o) => `${'  '.repeat(o.level)}- ${o.title} (p.${o.page})`)
    .join('\n')

  emit('detecting-chapters', 0.42, detail.analyzing)
  const analysisRaw = await ai.complete(analysisPrompt(project.name, condensed, outlineText, language))
  emit('extracting-concepts', 0.7)
  const parsed = parseModelJson<Omit<Analysis, 'totalPages'>>(analysisRaw)
  const analysis: Analysis = {
    totalPages: extracted.totalPages,
    toc: parsed.toc ?? extracted.outline,
    chapters: parsed.chapters ?? [],
    keywords: parsed.keywords ?? [],
    concepts: parsed.concepts ?? [],
    summary: parsed.summary ?? ''
  }
  await store.saveAnalysis(project.id, analysis)

  emit('creating-learning-plan', 0.78, detail.planning)
  const planRaw = await ai.complete(planPrompt(project.name, JSON.stringify(analysis), language))
  const planParsed = parseModelJson<{
    goal: string
    steps: { title: string; description: string; concepts: string[]; pages: number[] }[]
  }>(planRaw)
  const plan: LearningPlan = {
    goal: planParsed.goal ?? '',
    steps: (planParsed.steps ?? []).map((s) => ({
      id: newId(8),
      title: s.title,
      description: s.description ?? '',
      concepts: s.concepts ?? [],
      pages: s.pages ?? [],
      status: 'pending'
    }))
  }
  await store.savePlan(project.id, plan)

  const session: LearningSession = {
    currentStepId: plan.steps[0]?.id ?? null,
    currentPage: plan.steps[0]?.pages[0] ?? 1,
    completedStepIds: [],
    weakConcepts: [],
    strongConcepts: [],
    recommendedNextStepId: plan.steps[0]?.id ?? null,
    learningGoal: plan.goal,
    updatedAt: new Date().toISOString()
  }
  await store.saveSession(project.id, session)

  emit('done', 1)
}
