import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useAppStore } from '../../store/appStore'
import { useT } from '../../i18n'
import PaneMenu from '../PaneMenu'
import { IconChevronLeft, IconChevronRight, IconZoomIn, IconZoomOut } from '../icons'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const isMac = navigator.platform.toUpperCase().includes('MAC')

interface HighlightRect {
  x: number
  y: number
  w: number
  h: number
}

const normalize = (s: string): string => s.replace(/\s+/g, '').toLowerCase()

type PdfTextItem = import('pdfjs-dist/types/src/display/api').TextItem

function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return set
}

function diceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const g of a) if (b.has(g)) shared++
  return (2 * shared) / (a.size + b.size)
}

/**
 * Acronyms, numbers, and API/product names (TCP, HTTP/2, GC, 3-way, ...) tend
 * to survive translation untouched even when the rest of a summary sentence
 * is written in a different language than the source document. When the
 * summary language differs from the document's, these are often the only
 * substrings that can still be found on the page.
 */
function extractLatinTokens(s: string): string[] {
  const matches = s.match(/[A-Za-z0-9][A-Za-z0-9./+-]{2,}/g) ?? []
  return [...new Set(matches.map((t) => t.toLowerCase()))]
}

/** Merges per-item rects into one rect per visual line (adjacent items on the same baseline). */
function buildLineRects(
  viewport: ReturnType<PDFDocumentProxy['getPage']> extends never ? never : { transform: number[] },
  scale: number,
  items: PdfTextItem[],
  indices: number[]
): HighlightRect[] {
  const lines: HighlightRect[] = []
  for (const k of indices) {
    const item = items[k]
    const tx = pdfjs.Util.transform(viewport.transform, item.transform)
    const fontH = Math.hypot(tx[2], tx[3]) || 10
    const rect = {
      x: tx[4] - 2,
      y: tx[5] - fontH - 1,
      w: item.width * scale + 4,
      h: fontH * 1.3 + 2
    }
    const line = lines.find((l) => Math.abs(l.y - rect.y) < fontH * 0.6)
    if (line) {
      const right = Math.max(line.x + line.w, rect.x + rect.w)
      line.x = Math.min(line.x, rect.x)
      line.w = right - line.x
      line.h = Math.max(line.h, rect.h)
    } else {
      lines.push(rect)
    }
  }
  return lines.slice(0, 8)
}

/**
 * Locates where a summary sentence came from: finds the contiguous run of
 * text items whose combined text is most similar (bigram Dice) to the query,
 * so only the actual source region lights up — not every word occurrence.
 *
 * When the summary is written in a different language than the source
 * document, bigram similarity is essentially always ~0 (no character overlap
 * between e.g. Korean and English), so this falls back to matching whatever
 * acronyms/numbers/terms the query and the page text still share verbatim.
 */
async function findHighlightRects(
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
  scale: number,
  query: string
): Promise<HighlightRect[]> {
  const q = normalize(
    query.replace(/\d+쪽\s*→?/g, ' ').replace(/[*_`>#|[\]()→·]/g, ' ')
  )
  if (q.length < 6) return []

  const viewport = page.getViewport({ scale })
  const content = await page.getTextContent()
  const items = content.items.filter(
    (it): it is PdfTextItem => 'str' in it && !!it.str.trim()
  )
  if (items.length === 0) return []
  const texts = items.map((it) => normalize(it.str))

  // best contiguous window of items vs. the query sentence
  const qGrams = bigrams(q)
  let best = { score: 0, from: 0, to: 0 }
  const maxLen = Math.max(q.length * 1.6, q.length + 24)
  for (let i = 0; i < items.length; i++) {
    let acc = ''
    for (let j = i; j < items.length && j - i < 40; j++) {
      acc += texts[j]
      if (acc.length > maxLen) break
      const score = diceSimilarity(bigrams(acc), qGrams)
      if (score > best.score) best = { score, from: i, to: j }
    }
  }
  if (best.score >= 0.32) {
    const indices = Array.from({ length: best.to - best.from + 1 }, (_, i) => best.from + i)
    return buildLineRects(viewport, scale, items, indices)
  }

  // Cross-language fallback: same-script similarity found nothing — try
  // matching shared acronyms/numbers/terms instead of the whole sentence.
  const tokens = extractLatinTokens(query)
  if (tokens.length === 0) return []
  const matched = items
    .map((it, idx) => ({ idx, str: it.str.toLowerCase() }))
    .filter(({ str }) => tokens.some((t) => str.includes(t)))
    .map(({ idx }) => idx)
  if (matched.length === 0) return []
  return buildLineRects(viewport, scale, items, matched)
}

/** Union bounding box (for the dimming spotlight ring). */
function unionRect(rects: HighlightRect[]): HighlightRect {
  const x1 = Math.min(...rects.map((r) => r.x))
  const y1 = Math.min(...rects.map((r) => r.y))
  const x2 = Math.max(...rects.map((r) => r.x + r.w))
  const y2 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x1 - 6, y: y1 - 6, w: x2 - x1 + 12, h: y2 - y1 + 12 }
}

/** Renders one page to its own canvas. Mounted only while near the viewport. */
function PageCanvas({
  doc,
  page,
  scale,
  width,
  height
}: {
  doc: PDFDocumentProxy | null
  page: number
  scale: number
  width: number
  height: number
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!doc || scale <= 0) return
    let cancelled = false
    let task: { promise: Promise<void>; cancel: () => void } | null = null
    void (async () => {
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        const dpr = window.devicePixelRatio || 1
        const viewport = pdfPage.getViewport({ scale: scale * dpr })
        const canvas = ref.current
        if (!canvas) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        task = pdfPage.render({ canvasContext: ctx, viewport })
        await task.promise
      } catch {
        // cancellation is expected while scrolling/zooming quickly
      }
    })()
    return () => {
      cancelled = true
      try {
        task?.cancel()
      } catch {
        // already settled
      }
    }
  }, [doc, page, scale])
  return <canvas ref={ref} style={{ width, height, display: 'block' }} />
}

const GAP = 14 // vertical space between stacked pages
const PAD = 16 // top/bottom padding of the scroll column
const BUFFER = 2 // extra pages rendered above/below the viewport

export default function PdfViewer(): JSX.Element {
  const paneRole = useAppStore((s) => s.paneRole)
  const activeProject = useAppStore((s) => s.activeProject)
  const currentPage = useAppStore((s) => s.currentPage)
  const settings = useAppStore((s) => s.settings)
  const highlightRequest = useAppStore((s) => s.highlightRequest)
  const plan = useAppStore((s) => s.plan)
  const setPage = useAppStore((s) => s.setPage)
  const revealStep = useAppStore((s) => s.revealStep)
  const setWindowMode = useAppStore((s) => s.setWindowMode)

  const wrapRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const baseSizeRef = useRef({ w: 0, h: 0 }) // page size at scale 1
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(0) // 0 = initial fit pending
  const [pageInput, setPageInput] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState({ start: 1, end: 1 })
  const t = useT()
  const [highlights, setHighlights] = useState<{
    nonce: number
    page: number
    rects: HighlightRect[]
  }>({ nonce: 0, page: 0, rects: [] })
  const appliedHighlightRef = useRef(0)
  const clickStartRef = useRef<{ x: number; y: number } | null>(null)

  // 'page' (default: whole page fits within both width and height; pages then
  // stack and scroll continuously) | 'width' | 'height' | null (manual zoom)
  const fitModeRef = useRef<'page' | 'height' | 'width' | null>('page')

  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage
  const scrollDrivenPageRef = useRef(0) // last page set from scrolling
  const programmaticRef = useRef(false) // suppress the scroll handler during scrollToPage
  const scrollRafRef = useRef(0)

  const pageW = baseSizeRef.current.w * scale
  const pageH = baseSizeRef.current.h * scale
  const innerHeight =
    totalPages > 0 && pageH > 0 ? PAD * 2 + totalPages * pageH + (totalPages - 1) * GAP : 0
  const offsetOf = useCallback(
    (n: number): number => PAD + (Math.min(Math.max(n, 1), totalPages) - 1) * (pageH + GAP),
    [pageH, totalPages]
  )

  const fitTo = useCallback((mode: 'page' | 'height' | 'width'): void => {
    const wrap = wrapRef.current
    const { w, h } = baseSizeRef.current
    if (!wrap || !w || !h) return
    fitModeRef.current = mode
    const fitW = (wrap.clientWidth - 48) / w
    const fitH = (wrap.clientHeight - 36) / h
    // 'width' fills the pane and reads as a continuous scroll; 'page' contains
    // the whole page (a wide/landscape page fits instead of overflowing).
    const target = mode === 'width' ? fitW : mode === 'height' ? fitH : Math.min(fitW, fitH)
    setScale(Math.min(3, Math.max(0.3, +target.toFixed(3))))
  }, [])

  // recompute which pages are near the viewport (virtualized rendering)
  const updateRange = useCallback((): void => {
    const wrap = wrapRef.current
    if (!wrap || pageH <= 0 || totalPages === 0) return
    const u = pageH + GAP
    const start = Math.max(1, Math.floor((wrap.scrollTop - PAD) / u) + 1 - BUFFER)
    const end = Math.min(totalPages, Math.floor((wrap.scrollTop + wrap.clientHeight - PAD) / u) + 1 + BUFFER)
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }))
  }, [pageH, totalPages])

  const onScroll = useCallback((): void => {
    cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      updateRange()
      const wrap = wrapRef.current
      if (!wrap || programmaticRef.current || pageH <= 0 || totalPages === 0) return
      const u = pageH + GAP
      const cur = Math.min(
        totalPages,
        Math.max(1, Math.floor((wrap.scrollTop + wrap.clientHeight * 0.35 - PAD) / u) + 1)
      )
      if (cur !== currentPageRef.current) {
        scrollDrivenPageRef.current = cur
        setPage(cur)
      }
    })
  }, [updateRange, pageH, totalPages, setPage])

  const scrollToPage = useCallback(
    (n: number): void => {
      const wrap = wrapRef.current
      if (!wrap || pageH <= 0) return
      programmaticRef.current = true
      wrap.scrollTop = offsetOf(n)
      requestAnimationFrame(() => {
        programmaticRef.current = false
        updateRange()
      })
    },
    [pageH, offsetOf, updateRange]
  )

  // keep the fit across pane resizes until the user zooms manually
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let raf = 0
    const observer = new ResizeObserver(() => {
      const mode = fitModeRef.current
      if (!mode) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => fitTo(mode))
    })
    observer.observe(wrap)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [fitTo])

  // load document when the project changes
  useEffect(() => {
    let cancelled = false
    setError(null)
    if (!activeProject) return
    void (async () => {
      try {
        const data = await window.api.readPdf(activeProject.pdfPath)
        const doc = await pdfjs.getDocument({
          data,
          cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
          cMapPacked: true,
          standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
          useSystemFonts: true
        }).promise
        if (cancelled) {
          void doc.destroy()
          return
        }
        docRef.current = doc
        const first = await doc.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        baseSizeRef.current = { w: vp.width, h: vp.height }
        first.cleanup()
        setTotalPages(doc.numPages)
        fitTo('page')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      void docRef.current?.destroy()
      docRef.current = null
      baseSizeRef.current = { w: 0, h: 0 }
      fitModeRef.current = 'page'
      setTotalPages(0)
      setScale(0)
      setRange({ start: 1, end: 1 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.pdfPath])

  // on scale change (zoom / fit / resize): re-layout and keep the page in view
  useEffect(() => {
    if (scale <= 0 || totalPages === 0) return
    updateRange()
    scrollToPage(currentPageRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, totalPages])

  // external page change (anchor / page input / prev-next) → scroll into view
  useEffect(() => {
    if (scale <= 0 || totalPages === 0) return
    if (currentPage === scrollDrivenPageRef.current) return
    scrollToPage(currentPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  const go = useCallback(
    (page: number): void => {
      if (totalPages === 0) return
      setPage(Math.min(Math.max(page, 1), totalPages))
    },
    [totalPages, setPage]
  )

  // ----- keyboard navigation -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          go(currentPageRef.current - 1)
          break
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault()
          go(currentPageRef.current + 1)
          break
        case 'Home':
          e.preventDefault()
          go(1)
          break
        case 'End':
          e.preventDefault()
          go(totalPages)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, totalPages])

  // ----- clicking a page reveals its summary section on the right -----
  // a section "owns" a page in proportion to how often its summary actually
  // cites it ([p:N] anchors count more than coarse plan page ranges), so the
  // most-specific section wins instead of a broad overview section
  const revealForPage = useCallback(
    (page: number): void => {
      if (!plan) return
      const conversation = useAppStore.getState().conversation
      const scored = plan.steps.map((step) => {
        const study = conversation.find(
          (e) => e.role === 'assistant' && e.kind === 'study' && e.stepId === step.id
        )
        let citations = 0
        const cited: number[] = []
        if (study) {
          for (const m of study.text.matchAll(/\[p:(\d+)\]/gi)) {
            const p = Number(m[1])
            cited.push(p)
            if (p === page) citations++
          }
        }
        const planHit = step.pages.includes(page) ? 1 : 0
        const allPages = [...step.pages, ...cited]
        const span =
          allPages.length > 0 ? Math.max(...allPages) - Math.min(...allPages) + 1 : Infinity
        const minPage = allPages.length > 0 ? Math.min(...allPages) : Infinity
        return { step, score: citations * 2 + planHit, span, minPage }
      })

      const hits = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.span - b.span)
      let target = hits[0]?.step
      if (!target) {
        const before = scored
          .filter((s) => s.minPage <= page)
          .sort((a, b) => b.minPage - a.minPage)
        target = before[0]?.step ?? plan.steps[0]
      }
      if (target) revealStep(target.id)
    },
    [plan, revealStep]
  )

  // ----- spotlight the region a clicked summary sentence came from -----
  useEffect(() => {
    const req = highlightRequest
    const doc = docRef.current
    if (!req || !doc || req.nonce === appliedHighlightRef.current || scale <= 0) return
    appliedHighlightRef.current = req.nonce
    scrollToPage(req.page)
    let cancelled = false
    void (async () => {
      try {
        const page = await doc.getPage(req.page)
        const rects = await findHighlightRects(page, scale, req.query)
        if (!cancelled && rects.length > 0) {
          setHighlights({ nonce: req.nonce, page: req.page, rects })
          setTimeout(() => {
            if (!cancelled) setHighlights((h) => (h.nonce === req.nonce ? { ...h, rects: [] } : h))
          }, 1500)
        }
      } catch {
        // highlight is best-effort
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightRequest, scale])

  const separate = settings?.windowMode === 'separate'
  const pages: number[] = []
  if (pageH > 0) for (let p = range.start; p <= range.end; p++) pages.push(p)

  return (
    <>
      <div
        className="pane-header"
        style={paneRole === 'both' && isMac ? { paddingLeft: 84 } : undefined}
      >
        <div className="seg">
          <button
            className="icon-btn"
            onClick={() => go(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <IconChevronLeft />
          </button>
          <button
            className="icon-btn"
            onClick={() => go(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            <IconChevronRight />
          </button>
        </div>
        <input
          type="text"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = parseInt(pageInput, 10)
              if (!Number.isNaN(n)) go(n)
            }
          }}
          onBlur={() => setPageInput(String(currentPage))}
        />
        <span className="page-info">/ {totalPages || '–'}</span>
        <span style={{ flex: 1 }} className="drag-region" />
        <button
          className="icon-btn"
          onClick={() => {
            fitModeRef.current = null
            setScale((s) => Math.max(0.3, +((s || 1) - 0.15).toFixed(2)))
          }}
        >
          <IconZoomOut />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            fitModeRef.current = null
            setScale((s) => Math.min(3, +((s || 1) + 0.15).toFixed(2)))
          }}
        >
          <IconZoomIn />
        </button>
        <PaneMenu
          title="Options"
          items={[
            { label: t('menu.fitPage'), onClick: () => fitTo('page') },
            { label: t('menu.fitW'), onClick: () => fitTo('width') },
            { label: t('menu.fitH'), onClick: () => fitTo('height') },
            {
              label: t('menu.actual'),
              onClick: () => {
                fitModeRef.current = null
                setScale(1)
              }
            },
            { type: 'separator' },
            {
              label: separate ? t('menu.mergeWin') : t('menu.separate'),
              onClick: () => void setWindowMode(separate ? 'split' : 'separate')
            }
          ]}
        />
      </div>
      <div
        className="pdf-canvas-wrap"
        ref={wrapRef}
        onScroll={onScroll}
        onMouseDown={(e) => {
          clickStartRef.current = { x: e.clientX, y: e.clientY }
        }}
        onClick={(e) => {
          // ignore drags/pans — only treat stationary clicks as "reveal"
          const start = clickStartRef.current
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return
          const el = (e.target as HTMLElement).closest('.pdf-page') as HTMLElement | null
          revealForPage(el ? Number(el.dataset.page) : currentPageRef.current)
        }}
      >
        {error ? (
          <div className="error-banner">
            {t('pdf.openFailed')}: {error}
          </div>
        ) : (
          <div className="pdf-scroll-inner" style={{ height: innerHeight, width: pageW || undefined }}>
            {pages.map((p) => (
              <div
                key={p}
                className="pdf-page"
                data-page={p}
                style={{ top: offsetOf(p), width: pageW, height: pageH }}
              >
                <PageCanvas doc={docRef.current} page={p} scale={scale} width={pageW} height={pageH} />
                {highlights.page === p && highlights.rects.length > 0 && (
                  <>
                    <div
                      key={`ring-${highlights.nonce}`}
                      className="pdf-spot-ring"
                      style={(() => {
                        const u = unionRect(highlights.rects)
                        return { left: u.x, top: u.y, width: u.w, height: u.h }
                      })()}
                    />
                    {highlights.rects.map((r, i) => (
                      <div
                        key={`${highlights.nonce}-${i}`}
                        className="pdf-spot-line"
                        style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                      />
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
