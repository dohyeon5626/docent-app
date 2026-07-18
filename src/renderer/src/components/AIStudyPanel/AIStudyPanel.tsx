import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import mermaid from 'mermaid'
import type { ConversationEntry, LearningStep } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import { useT } from '../../i18n'
import PaneMenu, { Popover } from '../PaneMenu'
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconSend, IconStop } from '../icons'

marked.setOptions({ breaks: true })

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** Reactive dark-mode flag (follows the theme setting via nativeTheme). */
function useIsDark(): boolean {
  const [dark, setDark] = useState(darkQuery.matches)
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches)
    darkQuery.addEventListener('change', onChange)
    return () => darkQuery.removeEventListener('change', onChange)
  }, [])
  return dark
}

// rendered-diagram cache: source text -> svg (avoids re-render while streaming)
const mermaidCache = new Map<string, string>()
let mermaidSeq = 0
let mermaidTheme: 'dark' | 'neutral' | '' = ''

/**
 * Swaps ```mermaid code blocks for rendered SVG diagrams (best-effort), and
 * re-renders existing diagrams when the theme flips.
 */
async function renderMermaidBlocks(root: HTMLElement, dark: boolean): Promise<void> {
  const theme = dark ? 'dark' : 'neutral'
  if (theme !== mermaidTheme) {
    mermaidTheme = theme
    mermaidCache.clear()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily: MERMAID_FONT
    })
  }

  const renderInto = async (holder: HTMLElement, source: string): Promise<boolean> => {
    const cached = mermaidCache.get(source)
    if (cached) {
      holder.innerHTML = cached
      return true
    }
    try {
      // incomplete sources (mid-stream) fail parse and stay as-is
      await mermaid.parse(source)
      const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, source)
      mermaidCache.set(source, svg)
      holder.innerHTML = svg
      return true
    } catch {
      return false
    }
  }

  for (const code of Array.from(root.querySelectorAll<HTMLElement>('code.language-mermaid'))) {
    const source = code.textContent ?? ''
    const pre = code.closest('pre')
    if (!pre) continue
    const holder = document.createElement('div')
    holder.className = 'mermaid-diagram'
    holder.dataset.src = source
    if (await renderInto(holder, source)) pre.replaceWith(holder)
  }
  // theme changed: refresh diagrams that were already swapped in
  for (const holder of Array.from(
    root.querySelectorAll<HTMLElement>('.mermaid-diagram[data-src]')
  )) {
    const source = holder.dataset.src ?? ''
    if (source && !mermaidCache.has(source)) await renderInto(holder, source)
  }
}

/** Resolves any CSS color string (hex/rgb/named) to an [r,g,b] triplet via the browser's own parser. */
function parseCssColor(value: string): [number, number, number] | null {
  const probe = document.createElement('span')
  probe.style.color = value
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  document.body.removeChild(probe)
  const m = resolved.match(/[\d.]+/g)
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : null
}

const isDarkColor = (rgb: [number, number, number]): boolean =>
  rgb[0] < 70 && rgb[1] < 70 && rgb[2] < 70
const isLightColor = (rgb: [number, number, number]): boolean =>
  rgb[0] > 200 && rgb[1] > 200 && rgb[2] > 200

const MERMAID_FONT = '-apple-system, BlinkMacSystemFont, sans-serif'

/**
 * Re-renders every mermaid diagram in `root` (a detached clone) using the
 * light 'neutral' theme, regardless of the app's current dark/light setting.
 * When the app is in dark mode, mermaid's 'dark' theme fills nodes near-black
 * by default — fine on screen, but a solid black box wastes a lot of ink and
 * looks bad when printed to PDF. Diagrams keep their original `data-src` so
 * this only touches the export clone, never the live document.
 */
async function relightMermaidDiagramsForExport(root: HTMLElement): Promise<void> {
  const holders = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-diagram[data-src]'))
  if (holders.length === 0) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
    fontFamily: MERMAID_FONT
  })
  for (const holder of holders) {
    const source = holder.dataset.src ?? ''
    if (!source) continue
    try {
      await mermaid.parse(source)
      const { svg } = await mermaid.render(`mmd-export-${Math.random().toString(36).slice(2)}`, source)
      holder.innerHTML = svg
    } catch {
      // re-parse failed (shouldn't happen for already-rendered sources) — keep as-is
    }
  }
  // restore mermaid's live config so the next on-screen render isn't left on 'neutral'
  if (mermaidTheme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: mermaidTheme,
      fontFamily: MERMAID_FONT
    })
  }
}

/**
 * Some AI-drawn diagrams also fill a node solid black directly (an explicit
 * `style` override), which no theme choice can undo. Flattens any remaining
 * near-black node fills (and their paired near-white label text) to a light,
 * print-friendly pair, matching the app's own --bg-soft/--text-dim colors.
 */
function flattenDarkMermaidFills(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.mermaid-diagram [style]'))) {
    const fill = el.style.getPropertyValue('fill')
    if (fill) {
      const rgb = parseCssColor(fill)
      if (rgb && isDarkColor(rgb)) {
        el.style.setProperty('fill', '#f5f5f7')
        el.style.setProperty('stroke', '#6e6e73')
      }
    }
    const color = el.style.getPropertyValue('color')
    if (color) {
      const rgb = parseCssColor(color)
      if (rgb && isLightColor(rgb)) el.style.setProperty('color', '#1d1d1f')
    }
  }
}

const BLOCK_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'TD', 'BLOCKQUOTE'])

/**
 * Post-processes rendered markdown: [p:N] sentence anchors are stripped from
 * the text and turn their containing block into a clickable page jump.
 * Blocks without their own anchor inherit the nearest one so the whole
 * document is navigable.
 */
function annotatePageAnchors(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const touched: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (/\[p:\d+\]/i.test(node.data)) touched.push(node)
  }
  for (const node of touched) {
    let page: number | null = null
    node.data = node.data.replace(/\s*\[p:(\d+)\]/gi, (_m, n: string) => {
      page = Number(n)
      return ''
    })
    if (page === null) continue
    let el: HTMLElement | null = node.parentElement
    while (el && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement
    const target = el ?? node.parentElement
    if (target && !target.dataset.page) {
      target.dataset.page = String(page)
      target.classList.add('anchored')
    }
  }
  const blocks = Array.from(
    doc.body.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, h4, table, pre, blockquote')
  )
  let lastPage: string | null = null
  const pending: HTMLElement[] = []
  for (const block of blocks) {
    if (block.dataset.page) {
      lastPage = block.dataset.page
      for (const p of pending.splice(0)) {
        p.dataset.page = lastPage
        p.classList.add('anchored')
      }
      continue
    }
    if (block.parentElement?.closest('[data-page]')) continue
    if (block.querySelector('[data-page]')) continue
    if (lastPage) {
      block.dataset.page = lastPage
      block.classList.add('anchored')
    } else {
      pending.push(block)
    }
  }
  // whole tables are clickable even when only some cells carry anchors
  for (const table of Array.from(doc.body.querySelectorAll<HTMLElement>('table'))) {
    if (table.dataset.page) continue
    const anchoredCell = table.querySelector<HTMLElement>('[data-page]')
    if (anchoredCell?.dataset.page) {
      table.dataset.page = anchoredCell.dataset.page
      table.classList.add('anchored')
    }
  }
  return doc.body.innerHTML
}

/** Renders summary markdown; [페이지 N]/[p:N] references become page jumps. */
function Markdown({ text }: { text: string }): JSX.Element {
  const setPage = useAppStore((s) => s.setPage)
  const lang = useAppStore((s) => s.settings?.language ?? 'ko')
  const isDark = useIsDark()
  const mdRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    // study-note markup: colored highlighters, big takeaway line, small notes
    const withMarks = text
      .replace(
        /==(?:(red|green|blue|yellow):)?([^=\n]+)==/g,
        (_m, color: string | undefined, body: string) =>
          `<mark class="hl-${color ?? 'yellow'}">${body}</mark>`
      )
      .replace(/!!([^!\n]{2,120})!!/g, '<span class="note-big">$1</span>')
      .replace(/%%([^%\n]{2,200})%%/g, '<small class="note-small">$1</small>')
    const withLinks = withMarks.replace(
      /\[(?:페이지|page)\s*(\d+)\]/gi,
      (_m, n: string) =>
        `<a class="page-link" data-page="${n}">${lang === 'ko' ? `${n}쪽` : `p.${n}`}</a>`
    )
    const sanitized = DOMPurify.sanitize(marked.parse(withLinks, { async: false }) as string, {
      ADD_ATTR: ['data-page']
    })
    return annotatePageAnchors(sanitized)
  }, [text, lang])

  useEffect(() => {
    if (mdRef.current) void renderMermaidBlocks(mdRef.current, isDark)
  }, [html, isDark])

  return (
    <div
      className="md"
      ref={mdRef}
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest('[data-page]')
        const page = target?.getAttribute('data-page')
        if (!page) return
        const query = target?.classList.contains('anchored')
          ? (target.textContent ?? '').trim()
          : undefined
        setPage(Number(page), query ? { highlight: query } : undefined)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function TypingDots(): JSX.Element {
  return (
    <div className="typing-dots">
      <span />
      <span />
      <span />
    </div>
  )
}

interface Section {
  step: LearningStep
  index: number
  study: ConversationEntry | null
}

function buildSections(steps: LearningStep[], conversation: ConversationEntry[]): Section[] {
  return steps.map((step, index) => ({
    step,
    index,
    study:
      conversation.find(
        (e) => e.role === 'assistant' && e.kind === 'study' && e.stepId === step.id
      ) ?? null
  }))
}

/** strip the leading "[페이지 N]" chip from pre-generated summaries */
const stripLeadingPageRef = (text: string): string =>
  text.replace(/^\s*\[(?:페이지|page)\s*\d+\]\s*/i, '')

export default function AIStudyPanel(): JSX.Element {
  const plan = useAppStore((s) => s.plan)
  const session = useAppStore((s) => s.session)
  const settings = useAppStore((s) => s.settings)
  const paneRole = useAppStore((s) => s.paneRole)
  const conversation = useAppStore((s) => s.conversation)
  const streaming = useAppStore((s) => s.streaming)
  const aiError = useAppStore((s) => s.aiError)
  const summaryProgress = useAppStore((s) => s.summaryProgress)
  const summaryError = useAppStore((s) => s.summaryError)
  const retrySummaries = useAppStore((s) => s.retrySummaries)
  const revealTarget = useAppStore((s) => s.revealTarget)
  const qaPanel = useAppStore((s) => s.qaPanel)
  const mergingStepId = useAppStore((s) => s.mergingStepId)
  const activeProject = useAppStore((s) => s.activeProject)
  const ask = useAppStore((s) => s.ask)
  const retryLast = useAppStore((s) => s.retryLast)
  const cancelStreaming = useAppStore((s) => s.cancelStreaming)
  const closeQaPanel = useAppStore((s) => s.closeQaPanel)
  const mergeSupplements = useAppStore((s) => s.mergeSupplements)
  const restartLearning = useAppStore((s) => s.restartLearning)
  const setProjectSummaryLevel = useAppStore((s) => s.setProjectSummaryLevel)
  const setProjectSummaryLanguage = useAppStore((s) => s.setProjectSummaryLanguage)
  const reportReadingStep = useAppStore((s) => s.reportReadingStep)
  const setPage = useAppStore((s) => s.setPage)
  const goToProjects = useAppStore((s) => s.goToProjects)
  const setWindowMode = useAppStore((s) => s.setWindowMode)

  const t = useT()
  const [input, setInput] = useState('')
  const [stepsOpen, setStepsOpen] = useState(false)
  const [readPos, setReadPos] = useState({ current: 0, max: 0 })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const qaBodyRef = useRef<HTMLDivElement>(null)
  const appliedRevealRef = useRef(0)
  const suppressTrackingUntil = useRef(0)

  // ---------- document search (Cmd+F) ----------
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState({ count: 0, active: 0 })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const rangesRef = useRef<Range[]>([])

  const clearSearchHighlights = useCallback((): void => {
    CSS.highlights?.delete('doc-search')
    CSS.highlights?.delete('doc-search-active')
    rangesRef.current = []
  }, [])

  const focusMatch = useCallback((index: number): void => {
    const ranges = rangesRef.current
    const container = scrollRef.current
    if (ranges.length === 0 || !container) return
    const i = ((index % ranges.length) + ranges.length) % ranges.length
    CSS.highlights?.set('doc-search-active', new Highlight(ranges[i]))
    const rect = ranges[i].getBoundingClientRect()
    const cRect = container.getBoundingClientRect()
    suppressTrackingUntil.current = Date.now() + 600
    container.scrollTop += rect.top - cRect.top - container.clientHeight / 3
    setSearchState({ count: ranges.length, active: i })
  }, [])

  const runSearch = useCallback(
    (query: string): void => {
      clearSearchHighlights()
      const container = scrollRef.current
      const q = query.trim().toLowerCase()
      if (!container || q.length < 1) {
        setSearchState({ count: 0, active: 0 })
        return
      }
      const ranges: Range[] = []
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const text = node.data.toLowerCase()
        let idx = text.indexOf(q)
        while (idx >= 0) {
          const range = new Range()
          range.setStart(node, idx)
          range.setEnd(node, idx + q.length)
          ranges.push(range)
          idx = text.indexOf(q, idx + q.length)
        }
      }
      rangesRef.current = ranges
      if (ranges.length > 0) {
        CSS.highlights?.set('doc-search', new Highlight(...ranges))
        focusMatch(0)
      } else {
        setSearchState({ count: 0, active: 0 })
      }
    },
    [clearSearchHighlights, focusMatch]
  )

  const closeSearch = useCallback((): void => {
    setSearchOpen(false)
    setSearchQuery('')
    clearSearchHighlights()
    setSearchState({ count: 0, active: 0 })
  }, [clearSearchHighlights])

  const exportPdf = useCallback(async (): Promise<void> => {
    if (!activeProject || !scrollRef.current || exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const clone = scrollRef.current.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.gen-banner, .error-card').forEach((el) => el.remove())
      await relightMermaidDiagramsForExport(clone)
      flattenDarkMermaidFills(clone)
      const result = await window.api.exportSummaryPdf({
        projectId: activeProject.id,
        title: activeProject.name,
        html: clone.innerHTML
      })
      if (!result.canceled && result.error) setExportError(result.error)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }, [activeProject, exporting])

  // re-run the search when the document content changes (merge, new sections)
  useEffect(() => {
    if (searchOpen && searchQuery) {
      const id = setTimeout(() => runSearch(searchQuery), 150)
      return () => clearTimeout(id)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => searchInputRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const steps = plan?.steps ?? []
  const sections = useMemo(() => buildSections(steps, conversation), [steps, conversation])
  const currentIdx = steps.findIndex((s) => s.id === session?.currentStepId)
  const currentStep = currentIdx >= 0 ? steps[currentIdx] : undefined

  const autosize = (): void => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`
  }

  // keep the streaming answer visible inside the QA panel
  useEffect(() => {
    const el = qaBodyRef.current
    if (el && qaPanel?.status === 'streaming') el.scrollTop = el.scrollHeight
  }, [qaPanel?.answer, qaPanel?.status])

  // scroll to a step section when requested (steps popover, PDF click, sync)
  useEffect(() => {
    if (!revealTarget || revealTarget.nonce === appliedRevealRef.current) return
    appliedRevealRef.current = revealTarget.nonce
    const container = scrollRef.current
    const el = document.getElementById(`sec-${revealTarget.stepId}`)
    if (container && el) {
      suppressTrackingUntil.current = Date.now() + 1200
      container.scrollTo({ top: Math.max(el.offsetTop - 8, 0), behavior: 'smooth' })
      el.classList.remove('flash')
      requestAnimationFrame(() => el.classList.add('flash'))
    }
  }, [revealTarget])

  // track reading position: drives the progress bar, persists it to the
  // session, and pins questions to the step being read
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const range = Math.max(el.scrollHeight - el.clientHeight, 1)
    const fraction = Math.min(el.scrollTop / range, 1)
    let nextMax = fraction
    setReadPos((p) => {
      nextMax = Math.max(p.max, fraction)
      return { current: fraction, max: nextMax }
    })
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      const project = useAppStore.getState().activeProject
      if (project)
        void window.api.updateSession(project.id, {
          readCurrentRatio: fraction,
          readMaxRatio: nextMax
        })
    }, 600)

    if (Date.now() < suppressTrackingUntil.current) return
    const threshold = el.scrollTop + 90
    let readingId: string | null = null
    for (const section of sections) {
      const node = document.getElementById(`sec-${section.step.id}`)
      if (node && node.offsetTop <= threshold) readingId = section.step.id
    }
    if (readingId) reportReadingStep(readingId)
  }

  // restore saved reading position when the document is ready (once/project)
  const restoredForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeProject || sections.every((s) => !s.study)) return
    if (restoredForRef.current === activeProject.id) return
    restoredForRef.current = activeProject.id
    const max = session?.readMaxRatio ?? 0
    const current = session?.readCurrentRatio ?? 0
    setReadPos({ current, max })
    suppressTrackingUntil.current = Date.now() + 1500
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      el.scrollTop = current * Math.max(el.scrollHeight - el.clientHeight, 1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, sections])

  // clicking the bar jumps to that position in the document
  const onBarClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = scrollRef.current
    if (!el) return
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    suppressTrackingUntil.current = Date.now() + 800
    el.scrollTo({
      top: fraction * Math.max(el.scrollHeight - el.clientHeight, 1),
      behavior: 'smooth'
    })
  }

  const send = (): void => {
    const q = input.trim()
    if (!q || streaming) return
    setInput('')
    requestAnimationFrame(autosize)
    void ask(q)
  }

  const separate = settings?.windowMode === 'separate'
  const generating = summaryProgress !== null

  // suggested question shown as the placeholder; Tab autofills it.
  // rotates with the step so it doesn't feel canned.
  const uiLang = settings?.language ?? 'ko'
  const suggestedQuestion = useMemo(() => {
    if (!currentStep) return null
    const title = currentStep.title
    const pool =
      uiLang === 'ko'
        ? [
            `"${title}"를 더 쉽게 설명해줘`,
            `"${title}"에서 시험에 나올 만한 부분은 어디야?`,
            `"${title}"를 실제 예시로 설명해줘`,
            `"${title}"에서 헷갈리기 쉬운 부분을 짚어줘`
          ]
        : [
            `Explain "${title}" more simply`,
            `What part of "${title}" is most likely to be tested?`,
            `Explain "${title}" with a concrete example`,
            `What's commonly confused about "${title}"?`
          ]
    return pool[currentIdx % pool.length]
  }, [currentStep, currentIdx, uiLang])
  const projectLevel = activeProject?.summaryLevel ?? settings?.summaryLevel ?? 'standard'
  const projectLang = activeProject?.summaryLanguage ?? settings?.language ?? 'ko'
  const qaStepTitle = qaPanel?.stepId
    ? steps.find((s) => s.id === qaPanel.stepId)?.title
    : undefined

  return (
    <div className="study-panel">
      <div className="pane-header">
        <Popover
          open={stepsOpen}
          setOpen={setStepsOpen}
          align="left"
          trigger={
            <button className="step-title-btn" onClick={() => setStepsOpen(!stepsOpen)}>
              <span className="strong">
                {currentStep ? `${currentIdx + 1}. ${currentStep.title}` : t('study.toc')}
              </span>
              <IconChevronDown />
            </button>
          }
        >
          <div className="menu-list steps-list">
            {steps.map((step, i) => (
              <button
                key={step.id}
                className={`menu-item ${step.id === session?.currentStepId ? 'current' : ''}`}
                onClick={() => {
                  setStepsOpen(false)
                  useAppStore.getState().revealStep(step.id)
                  if (step.pages[0]) setPage(step.pages[0])
                }}
              >
                <span className="check">
                  {i < currentIdx ? '✓' : step.id === session?.currentStepId ? '●' : ''}
                </span>
                <span className="label">
                  {i + 1}. {step.title}
                </span>
              </button>
            ))}
          </div>
        </Popover>
        <span style={{ flex: 1 }} className="drag-region" />
        <PaneMenu
          title="Options"
          items={[
            { label: t('menu.find'), detail: '⌘F', onClick: () => setSearchOpen(true) },
            { type: 'separator' },
            {
              label: separate ? t('menu.mergeWin') : t('menu.separate'),
              onClick: () => void setWindowMode(separate ? 'split' : 'separate')
            },
            { type: 'separator' },
            ...(['brief', 'standard', 'detailed'] as const).map((lvl) => ({
              label: `${t('menu.level')}: ${t(`settings.level.${lvl}` as const)}`,
              checked: projectLevel === lvl,
              onClick: () => void setProjectSummaryLevel(lvl)
            })),
            { type: 'separator' as const },
            ...([
              ['ko', '한국어'],
              ['en', 'English']
            ] as const).map(([lng, label]) => ({
              label: `${t('menu.lang')}: ${label}`,
              checked: projectLang === lng,
              onClick: () => void setProjectSummaryLanguage(lng)
            })),
            {
              label: t('menu.rebuild'),
              disabled: !!streaming,
              onClick: () => void restartLearning()
            },
            {
              label: t('menu.exportPdf'),
              disabled: exporting || sections.length === 0,
              onClick: () => void exportPdf()
            },
            ...(paneRole === 'both'
              ? [
                  { type: 'separator' as const },
                  { label: t('menu.allProjects'), onClick: goToProjects }
                ]
              : [])
          ]}
        />
      </div>
      {steps.length > 0 && (
        <div
          className="read-bar"
          title={t('study.readRange', { n: Math.round(readPos.max * 100) })}
          onClick={onBarClick}
        >
          <div className="read-fill" style={{ width: `${readPos.current * 100}%` }} />
          {readPos.max > readPos.current && (
            <div
              className="read-seen"
              style={{
                left: `${readPos.current * 100}%`,
                width: `${(readPos.max - readPos.current) * 100}%`
              }}
            />
          )}
          <div className="read-dot" style={{ left: `${readPos.current * 100}%` }} />
        </div>
      )}

      {searchOpen && (
        <div className="search-bar">
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('study.findPlaceholder')}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              runSearch(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch()
              else if (e.key === 'Enter')
                focusMatch(searchState.active + (e.shiftKey ? -1 : 1))
            }}
          />
          <span className="count">
            {searchState.count > 0 ? `${searchState.active + 1}/${searchState.count}` : '0'}
          </span>
          <button className="icon-btn" onClick={() => focusMatch(searchState.active - 1)}>
            <IconChevronLeft size={13} />
          </button>
          <button className="icon-btn" onClick={() => focusMatch(searchState.active + 1)}>
            <IconChevronRight size={13} />
          </button>
          <button className="icon-btn" onClick={closeSearch} title="Close (Esc)">
            ✕
          </button>
        </div>
      )}

      {exportError && (
        <div className="error-card" style={{ margin: '8px 12px 0' }}>
          <p>
            {t('study.exportFailed')}: {exportError}
          </p>
        </div>
      )}

      <div className="study-doc" ref={scrollRef} onScroll={onScroll}>
        {generating && (
          <div className="gen-banner">
            <span className="spinner small" /> {t('study.generating')} {summaryProgress!.done}/{summaryProgress!.total}
          </div>
        )}
        {summaryError && (
          <div className="error-card" style={{ marginTop: 12 }}>
            <p>
              {t('study.genFailed')}: {summaryError}
            </p>
            <button onClick={() => void retrySummaries()}>{t('common.retry')}</button>
          </div>
        )}

        {sections.map((section) => (
          <section key={section.step.id} id={`sec-${section.step.id}`} className="doc-section">
            <div className="doc-caption">
              <span className="num">{section.index + 1}</span>
              <span className="title">{section.step.title}</span>
            </div>
            {section.study ? (
              <Markdown text={stripLeadingPageRef(section.study.text)} />
            ) : (
              <div className="pending-section">{t('study.writing')}</div>
            )}
          </section>
        ))}
      </div>

      {qaPanel && (
        <div className="qa-panel">
          <div className="qa-head">
            <span className="q-mark">Q</span>
            <span className="q-text">{qaPanel.question}</span>
            {qaStepTitle && <span className="q-step">{qaStepTitle}</span>}
            <button className="icon-btn" title="Close" onClick={closeQaPanel}>
              ✕
            </button>
          </div>
          <div className="qa-body" ref={qaBodyRef}>
            {qaPanel.status === 'error' ? (
              <div className="error-card" style={{ margin: 0 }}>
                <p>{aiError ?? t('study.error')}</p>
                <button onClick={() => void retryLast()}>{t('common.retry')}</button>
              </div>
            ) : qaPanel.answer ? (
              <Markdown text={qaPanel.answer} />
            ) : (
              <TypingDots />
            )}
          </div>
          {qaPanel.status === 'done' && (
            <div className="qa-foot">
              <button
                className="primary"
                disabled={!qaPanel.stepId || mergingStepId !== null}
                onClick={() => qaPanel.stepId && void mergeSupplements(qaPanel.stepId)}
                title="답변 내용을 해당 섹션 요약에 통합합니다"
              >
                {mergingStepId ? t('qa.merging') : t('qa.merge')}
              </button>
              <button onClick={closeQaPanel}>{t('common.close')}</button>
            </div>
          )}
        </div>
      )}

      <div className="input-bar">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={
            suggestedQuestion ? `${suggestedQuestion}  ⇥` : t('study.askPlaceholder')
          }
          onChange={(e) => {
            setInput(e.target.value)
            autosize()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !input.trim() && suggestedQuestion) {
              // Tab autofills the suggested question shown as the placeholder
              e.preventDefault()
              setInput(suggestedQuestion)
              requestAnimationFrame(autosize)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        {streaming ? (
          <button className="send-btn stop" title={t('study.stop')} onClick={() => void cancelStreaming()}>
            <IconStop size={13} />
          </button>
        ) : (
          <button className="send-btn" title={t('study.send')} onClick={send} disabled={!input.trim()}>
            <IconSend size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
