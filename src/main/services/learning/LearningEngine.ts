import { newId } from '@shared/id'
import type {
  Analysis,
  AppLanguage,
  SummaryLevel,
  ConversationEntry,
  LearningPlan,
  LearningSession,
  PageText,
  SessionUpdatePayload
} from '@shared/types'
import type { AIProvider, AIRequestOptions } from '../claude/AIProvider'
import * as store from '../persistence/store'
import { parseModelJson } from '../pdf/AnalysisService'

const UPDATE_MARKER = '<<<SESSION_UPDATE>>>'

interface SessionUpdateDirective {
  understanding?: 'weak' | 'ok' | 'strong'
  weakConcepts?: string[]
  strongConcepts?: string[]
  completeCurrentStep?: boolean
  nextStepTitle?: string
  planChanges?: {
    reorderTitles?: string[]
    newSteps?: { afterTitle?: string; title: string; description: string; pages: number[] }[]
  }
  reason?: string
}

interface ProjectContext {
  analysis: Analysis
  plan: LearningPlan
  session: LearningSession
  conversation: ConversationEntry[]
  pages: PageText[]
}

async function loadContext(projectId: string): Promise<ProjectContext> {
  const [analysis, plan, session, conversation, pages] = await Promise.all([
    store.getAnalysis(projectId),
    store.getPlan(projectId),
    store.getSession(projectId),
    store.getConversation(projectId),
    store.getPageTexts(projectId)
  ])
  if (!analysis || !plan || !session) throw new Error('Project analysis data is missing')
  return { analysis, plan, session, conversation, pages }
}

function pagesText(pages: PageText[], wanted: number[], budget = 26000): string {
  const selected = pages.filter((p) => wanted.includes(p.page) && p.text)
  if (selected.length === 0) return '(no text on these pages)'
  const per = Math.max(900, Math.floor(budget / selected.length))
  return selected.map((p) => `[p.${p.page}] ${p.text.slice(0, per)}`).join('\n')
}

function recentConversation(conversation: ConversationEntry[], max = 12): string {
  return conversation
    .slice(-max)
    .map((e) => `${e.role === 'user' ? 'Learner' : 'Tutor'}: ${e.text.slice(0, 600)}`)
    .join('\n')
}

const QUALITY_BAR = `Quality bar — write like the top student's exam notes:
- Someone who reads ONLY this section must be able to answer questions about it. Concrete over vague: names, numbers, causes, consequences — all from the source.
- Every bullet must pass the "so what" test. Filler like "this is an important concept" is forbidden.
- Before writing, silently decide: the 3–7 things worth remembering, the one takeaway line, the trap learners fall into, and whether a diagram teaches faster than prose. Then write only the final section.`

const GOLD_EXAMPLE: Record<AppLanguage, string> = {
  ko: `[page 4]

!!TCP는 "확실한 배달", UDP는 "빠른 배달" — 신뢰성과 속도의 맞교환!!

### 왜 두 프로토콜이 있나
- **TCP**: 연결 지향. ==3-way handshake==로 연결을 만들고, 손실 시 재전송 [p:4]
- **UDP**: 비연결. 확인 절차 없이 바로 전송 — ==red:손실돼도 재전송하지 않음== [p:5]

| 구분 | TCP | UDP |
| --- | --- | --- |
| 연결 | ==blue:연결 지향== | ==blue:비연결== |
| 순서 보장 | O | X |
| 용도 | 웹, 메일 [p:4] | 스트리밍, 게임 [p:5] |

==green:신뢰성이 필요하면 TCP, 지연이 치명적이면 UDP==
%%QUIC은 UDP 위에 신뢰성을 얹은 절충안 [p:6]%%`,
  en: `[page 4]

!!TCP is "guaranteed delivery", UDP is "fast delivery" — a reliability/speed trade-off!!

### Why two protocols exist
- **TCP**: connection-oriented. Establishes a link via the ==3-way handshake==, retransmits on loss [p:4]
- **UDP**: connectionless. Sends immediately with no checks — ==red:lost packets are never resent== [p:5]

| | TCP | UDP |
| --- | --- | --- |
| Connection | ==blue:connection-oriented== | ==blue:connectionless== |
| Ordering | yes | no |
| Used for | web, mail [p:4] | streaming, games [p:5] |

==green:Need reliability → TCP; latency-critical → UDP==
%%QUIC layers reliability on top of UDP as a middle ground [p:6]%%`
}

const OUTPUT_LANGUAGE: Record<AppLanguage, string> = {
  ko: 'Write ALL output in Korean (한국어).',
  en: 'Write ALL output in English.'
}

function tutorSystemBlock(ctx: ProjectContext, level: SummaryLevel, lang: AppLanguage): string {
  const { plan, session } = ctx
  const current = plan.steps.find((s) => s.id === session.currentStepId)
  const planList = plan.steps
    .map((s, i) => {
      const mark =
        s.id === session.currentStepId ? '▶' : session.completedStepIds.includes(s.id) ? '✓' : ' '
      return `${mark} Step ${i + 1}. ${s.title} (p.${s.pages.join(',')})`
    })
    .join('\n')
  return `You are the summary writer and personal tutor inside a document-learning desktop app.
The left pane shows the original PDF; the right pane shows one continuous study document made of per-step summaries. The learner scrolls through it. ${OUTPUT_LANGUAGE[lang]}

Writing rules:
${formatRules(level, lang)}

Learning goal: ${session.learningGoal}
Plan (▶ = currently reading, ✓ = done):
${planList}

Current step: ${current ? `${current.title} — ${current.description}` : '(none)'}
Weak concepts: ${session.weakConcepts.join(', ') || '(none)'}
Strong concepts: ${session.strongConcepts.join(', ') || '(none)'}
Page currently visible: ${session.currentPage}`
}

const LEVEL_RULES: Record<AppLanguage, Record<SummaryLevel, string>> = {
  ko: {
    brief: 'Keep each section to 300–600 Korean characters (spaces included) — exam-cram style: definitions and conclusions only.',
    standard: 'Keep each section under 500–1000 Korean characters (spaces included).',
    detailed:
      'Each section may run 900–1800 Korean characters: cover more of the source in depth — secondary points, caveats, and any examples the source itself gives. Do not pad with outside knowledge.'
  },
  en: {
    brief: 'Keep each section to 100–200 words — exam-cram style: definitions and conclusions only.',
    standard: 'Keep each section under 180–350 words.',
    detailed:
      'Each section may run 320–650 words: cover more of the source in depth — secondary points, caveats, and any examples the source itself gives. Do not pad with outside knowledge.'
  }
}

const formatRules = (level: SummaryLevel, lang: AppLanguage): string =>
  FORMAT_RULES_BASE.replace('{{LENGTH}}', LEVEL_RULES[lang][level])

const FORMAT_RULES_BASE = `- Your output is a **summary**. Do not transcribe the source; reconstruct only the essentials. It must be much shorter than the source. {{LENGTH}}
- **Faithfulness is non-negotiable**: every claim must come from the source pages provided. Never invent facts, numbers, names, or examples that are not in the source. If the source doesn't cover something, leave it out — do not fill gaps from general knowledge.
- If a brief piece of outside context is truly essential to understand the source, put it on its own line prefixed with "※" and give it NO [p:N] anchor. Use this sparingly (at most 1 per section).
- Prioritize what a learner would be tested on: definitions, mechanisms ("why/how"), trade-offs, and hard facts. Drop anecdotes, restatements, and anything obvious from the title alone.
- Short sentences. One bullet = one fact. Never say the same thing twice.
- Put blank lines between blocks (subheadings, tables, lists) so the text can breathe.
- Open with "[page N]" stating where this content starts; the app scrolls the left PDF there.
- End every bullet/paragraph with "[p:N]" citing the source page; clicking it spotlights that spot. Omit it only for general knowledge not in the document.
- Combine varied markdown so it scans at a glance (use at least 2 of these every time):
  - Tables: always use one for comparisons, term glossaries, pros/cons.
  - "### subheadings" when there are two or more topic blocks.
  - Numbered lists or "A → B → C" arrows for processes, structure, flow.
  - Code blocks for example code, commands, config.
- Draw mermaid diagrams (\`\`\`mermaid code blocks) whenever a picture teaches faster than prose. Pick the type that fits the content — don't default to boxes and arrows:
  - flowchart LR/TD: processes, request flow, decision paths.
  - mindmap: concept breakdowns, classifications, "X consists of A/B/C".
  - sequenceDiagram: interactions between actors/components over time.
  - stateDiagram-v2: lifecycles and state transitions.
  - classDiagram / erDiagram: relationships between entities.
  - timeline: history, ordered eras or versions.
  - pie: proportions. quadrantChart: two-axis comparisons.
  - Keep node labels short, in the output language. Up to 2 per section when genuinely helpful.
- **Bold** = structure: start each bullet with its key term in bold (e.g. "- **Session drift**: when servers scale out ..."). Bold marks what a line is about.
- Text sizes — use them like real study notes:
  - !!one-line takeaway!! renders LARGE. The single most important conclusion of the section, 0–1 per section, on its own line.
  - %%small side note%% renders small and dim. Minor tips, edge details, "참고" asides. Sparingly.
- Colored highlighters — each color has a meaning. Minimal spans only (2–7 words, never a whole sentence/bullet, never bolded terms, never inside tables/headings/code). 2–5 total per section, zero is fine:
  - ==yellow highlight== (default): must-memorize — the decisive part of a definition, an exact number/limit.
  - ==red:common trap== : cautions, exceptions, things learners get wrong.
  - ==green:the rule== : conclusions and rules of thumb — "so the answer is X".
  - ==blue:contrast A== vs ==blue:contrast B== : the distinguishing words when two concepts are compared.
  - Bad: "- **JVM**: ==JVM은 바이트코드를 실행하는 가상 머신으로 플랫폼에 독립적이다==" (whole sentence).
  - Good: "- **JVM**: 바이트코드를 실행하는 가상 머신 — ==플랫폼 독립적== [p:12]".
- Never end with a comprehension question ("Does that make sense?").`

/** Splits the model output into the visible answer and the update directive. */
function splitUpdate(fullText: string): { visible: string; directive: SessionUpdateDirective | null } {
  const idx = fullText.lastIndexOf(UPDATE_MARKER)
  if (idx < 0) return { visible: fullText.trim(), directive: null }
  const visible = fullText.slice(0, idx).trim()
  try {
    const directive = parseModelJson<SessionUpdateDirective>(
      fullText.slice(idx + UPDATE_MARKER.length)
    )
    return { visible, directive }
  } catch {
    return { visible, directive: null }
  }
}

function applyDirective(
  plan: LearningPlan,
  session: LearningSession,
  directive: SessionUpdateDirective
): void {
  const merge = (into: string[], from: string[] | undefined): string[] =>
    Array.from(new Set([...into, ...(from ?? [])]))
  session.weakConcepts = merge(session.weakConcepts, directive.weakConcepts)
  session.strongConcepts = merge(session.strongConcepts, directive.strongConcepts)
  // a concept can't be both — the most recent signal wins
  session.weakConcepts = session.weakConcepts.filter(
    (c) => !(directive.strongConcepts ?? []).includes(c)
  )
  session.strongConcepts = session.strongConcepts.filter(
    (c) => !(directive.weakConcepts ?? []).includes(c)
  )

  const changes = directive.planChanges
  if (changes?.newSteps) {
    for (const ns of changes.newSteps) {
      const step = {
        id: newId(8),
        title: ns.title,
        description: ns.description ?? '',
        concepts: [],
        pages: ns.pages ?? [],
        status: 'pending' as const
      }
      const afterIdx = plan.steps.findIndex((s) => s.title === ns.afterTitle)
      const currentIdx = plan.steps.findIndex((s) => s.id === session.currentStepId)
      plan.steps.splice(afterIdx >= 0 ? afterIdx + 1 : currentIdx + 1, 0, step)
    }
  }
  if (changes?.reorderTitles?.length) {
    const byTitle = new Map(plan.steps.map((s) => [s.title, s]))
    const reordered = changes.reorderTitles
      .map((t) => byTitle.get(t))
      .filter((s): s is NonNullable<typeof s> => !!s)
    if (reordered.length === plan.steps.length) plan.steps = reordered
  }

  if (directive.completeCurrentStep && session.currentStepId) {
    const current = plan.steps.find((s) => s.id === session.currentStepId)
    if (current) {
      current.status = 'completed'
      if (!session.completedStepIds.includes(current.id))
        session.completedStepIds.push(current.id)
    }
    const next = directive.nextStepTitle
      ? plan.steps.find((s) => s.title === directive.nextStepTitle && s.status !== 'completed')
      : plan.steps.find((s) => s.status !== 'completed')
    session.recommendedNextStepId = next?.id ?? null
  }
  session.updatedAt = new Date().toISOString()
}

export interface LearnResult {
  visibleText: string
  sessionUpdate: SessionUpdatePayload
}

export class LearningEngine {
  constructor(
    private ai: AIProvider,
    private getLevel: (projectId: string) => Promise<SummaryLevel> = async () => 'standard',
    private getLang: (projectId: string) => Promise<AppLanguage> = async () => 'ko'
  ) {}

  /** Runs one tutoring turn and persists conversation + adapted session/plan. */
  private async runTurn(
    projectId: string,
    userEntry: ConversationEntry | null,
    prompt: string,
    kind: 'study' | 'answer',
    ctx: ProjectContext,
    options: AIRequestOptions
  ): Promise<LearnResult> {
    if (userEntry) {
      // skip duplicate append when a failed request is retried
      const last = ctx.conversation[ctx.conversation.length - 1]
      if (!(last?.role === 'user' && last.text === userEntry.text)) {
        await store.appendConversation(projectId, userEntry)
      }
    }

    // Stream to the UI but hold back a tail buffer so the SESSION_UPDATE
    // marker (and everything after it) never becomes visible.
    let acc = ''
    let emittedUpTo = 0
    let markerSeen = false
    const raw = await this.ai.complete(prompt, {
      signal: options.signal,
      onChunk: (text) => {
        if (markerSeen) return
        acc += text
        const markerIdx = acc.indexOf(UPDATE_MARKER)
        if (markerIdx >= 0) {
          markerSeen = true
          if (markerIdx > emittedUpTo) options.onChunk?.(acc.slice(emittedUpTo, markerIdx))
          emittedUpTo = markerIdx
          return
        }
        const safeEnd = Math.max(emittedUpTo, acc.length - UPDATE_MARKER.length)
        if (safeEnd > emittedUpTo) {
          options.onChunk?.(acc.slice(emittedUpTo, safeEnd))
          emittedUpTo = safeEnd
        }
      }
    })
    const { visible, directive } = splitUpdate(raw)

    const { plan, session } = ctx
    if (directive) applyDirective(plan, session, directive)
    const currentStep = plan.steps.find((s) => s.id === session.currentStepId)
    if (currentStep && currentStep.status === 'pending') currentStep.status = 'in-progress'

    await Promise.all([
      store.savePlan(projectId, plan),
      store.saveSession(projectId, session),
      store.appendConversation(projectId, {
        id: newId(10),
        role: 'assistant',
        kind,
        stepId: session.currentStepId,
        text: visible,
        createdAt: new Date().toISOString()
      })
    ])
    return { visibleText: visible, sessionUpdate: { session, plan } }
  }

  /**
   * Builds this step's summary via AI. Doesn't persist it — callers decide
   * whether to append (a section generated for the first time) or replace
   * (regenerating a section that already has one).
   */
  private async writeStepSummary(
    projectId: string,
    stepId: string,
    signal?: AbortSignal
  ): Promise<ConversationEntry> {
    const ctx = await loadContext(projectId)
    const step = ctx.plan.steps.find((s) => s.id === stepId)
    if (!step) throw new Error('Step not found')

    const lang = await this.getLang(projectId)
    const stepIdx = ctx.plan.steps.findIndex((st) => st.id === step.id)
    // concepts the analysis linked to this step's pages — depth cues for the writer
    const concepts = ctx.analysis.concepts
      .filter(
        (c) => step.concepts.includes(c.name) || c.pages.some((pg) => step.pages.includes(pg))
      )
      .slice(0, 8)
      .map((c) => `- ${c.name} (${c.difficulty}): ${c.description}`)
      .join('\n')
    // outline of the previous section, so this one doesn't repeat it
    const prevStep = stepIdx > 0 ? ctx.plan.steps[stepIdx - 1] : null
    const prevStudy = prevStep
      ? ctx.conversation.find(
          (e) => e.role === 'assistant' && e.kind === 'study' && e.stepId === prevStep.id
        )
      : null
    const prevOutline = prevStudy
      ? [
          ...prevStudy.text.matchAll(/^###\s*(.+)$/gm),
          ...prevStudy.text.matchAll(/\*\*([^*\n]{2,40})\*\*/g)
        ]
          .map((m) => m[1].trim())
          .slice(0, 12)
          .join(', ')
      : ''

    const prompt = `You are the summary writer for a document-learning study guide. ${OUTPUT_LANGUAGE[lang]}
You are writing the "${step.title}" section of one continuous study document made of per-step summaries.

${QUALITY_BAR}

Writing rules:
${formatRules(await this.getLevel(projectId), lang)}

Here is an example of the expected quality and formatting (different topic — copy the style, not the content):
${GOLD_EXAMPLE[lang]}

Full plan: ${ctx.plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join(' / ')}
This section: "${step.title}" — ${step.description}
Key concepts the analysis found for this section:
${concepts || '(none)'}
${prevOutline ? `The previous section already covered: ${prevOutline} — do not repeat these.` : ''}

Source text of the related pages:
${pagesText(ctx.pages, step.pages)}

Task: output only this section's summary based on the source above. Do not write the section title (the app renders it). Do not repeat content that belongs to other steps.`

    const raw = await this.ai.complete(prompt, { signal })
    const { visible } = splitUpdate(raw)
    return {
      id: newId(10),
      role: 'assistant',
      kind: 'study',
      stepId: step.id,
      text: visible,
      createdAt: new Date().toISOString()
    }
  }

  /**
   * Writes the summary document section for one step (used to pre-generate
   * the whole document after analysis). Doesn't touch the session.
   */
  async generateStepSummary(
    projectId: string,
    stepId: string,
    signal?: AbortSignal
  ): Promise<ConversationEntry> {
    const entry = await this.writeStepSummary(projectId, stepId, signal)
    await store.appendConversation(projectId, entry)
    return entry
  }

  /**
   * Regenerates a single section's summary in place — replaces whatever
   * study entry that step already had, leaving every other step (and any
   * of this step's un-merged Q&A) untouched. Returns the full conversation.
   */
  async regenerateStepSummary(
    projectId: string,
    stepId: string,
    signal?: AbortSignal
  ): Promise<ConversationEntry[]> {
    const entry = await this.writeStepSummary(projectId, stepId, signal)
    return store.updateConversation(projectId, (conversation) => [
      ...conversation.filter((e) => !(e.stepId === stepId && e.role === 'assistant' && e.kind === 'study')),
      entry
    ])
  }

  /**
   * Folds a step's Q&A supplements back into its summary section: rewrites
   * the summary to include what the learner asked about, then removes the
   * Q&A entries. Returns the updated conversation.
   */
  async mergeStepSupplements(projectId: string, stepId: string): Promise<ConversationEntry[]> {
    const ctx = await loadContext(projectId)
    const step = ctx.plan.steps.find((s) => s.id === stepId)
    if (!step) throw new Error('Step not found')
    const study = ctx.conversation.find(
      (e) => e.role === 'assistant' && e.kind === 'study' && e.stepId === stepId
    )
    const qas = ctx.conversation.filter(
      (e) => e.stepId === stepId && !(e.role === 'assistant' && e.kind === 'study')
    )
    if (!study || qas.length === 0) return ctx.conversation

    const qaText = qas
      .map((e) => `${e.role === 'user' ? 'Q' : 'A'}: ${e.text.slice(0, 1500)}`)
      .join('\n\n')

    const lang = await this.getLang(projectId)
    const prompt = `You are the summary writer for a document-learning study guide. ${OUTPUT_LANGUAGE[lang]}
Rewrite the "${step.title}" section summary, folding in what the learner asked about.

Writing rules:
${formatRules(await this.getLevel(projectId), lang)}

Current summary:
${study.text}

The learner's questions and answers:
${qaText}

Task: output the new summary, keeping the current structure but reinforcing the gaps the questions exposed. Do not transcribe the Q&A format — weave it into the prose. No section title. Do not grow the overall length much.`

    const raw = await this.ai.complete(prompt)
    const { visible } = splitUpdate(raw)
    return store.updateConversation(projectId, (conversation) =>
      conversation
        .filter((e) => !(e.stepId === stepId && !(e.role === 'assistant' && e.kind === 'study')))
        .map((e) => (e.id === study.id ? { ...e, text: visible } : e))
    )
  }

  /**
   * Answers a question as a supplement to the step the learner is reading;
   * the answer is inserted into the document under that step.
   */
  async ask(
    projectId: string,
    question: string,
    options: AIRequestOptions = {}
  ): Promise<LearnResult> {
    const ctx = await loadContext(projectId)
    const step = ctx.plan.steps.find((s) => s.id === ctx.session.currentStepId)
    const relatedPages = new Set<number>(step?.pages ?? [])
    // pull in pages for concepts mentioned in the question
    for (const concept of ctx.analysis.concepts) {
      if (question.includes(concept.name)) concept.pages.forEach((p) => relatedPages.add(p))
    }

    const userEntry: ConversationEntry = {
      id: newId(10),
      role: 'user',
      kind: 'question',
      stepId: ctx.session.currentStepId,
      text: question,
      createdAt: new Date().toISOString()
    }

    const lang = await this.getLang(projectId)
    const prompt = `${tutorSystemBlock(ctx, await this.getLevel(projectId), lang)}

Source text of the related pages:
${pagesText(ctx.pages, Array.from(relatedPages))}

Recent conversation:
${recentConversation(ctx.conversation)}

The learner asks: "${question}"

Task: write a supplementary explanation that answers the question. It will be shown alongside the "${step?.title ?? 'current'}" step summary. Cite evidence from the document with [page N] and per-sentence [p:N]; if the answer isn't in the document, answer from general knowledge and say so.
- The very last line MUST be exactly this format (it is hidden from the learner):
${UPDATE_MARKER}{"understanding":"weak|ok|strong","weakConcepts":[],"strongConcepts":[]}`

    return this.runTurn(projectId, userEntry, prompt, 'answer', ctx, options)
  }
}
