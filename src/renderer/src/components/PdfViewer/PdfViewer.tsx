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
 * Locates where a summary sentence came from: finds the contiguous run of
 * text items whose combined text is most similar (bigram Dice) to the query,
 * so only the actual source region lights up — not every word occurrence.
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
  const qGrams = bigrams(q)

  const viewport = page.getViewport({ scale })
  const content = await page.getTextContent()
  const items = content.items.filter(
    (it): it is import('pdfjs-dist/types/src/display/api').TextItem =>
      'str' in it && !!it.str.trim()
  )
  if (items.length === 0) return []
  const texts = items.map((it) => normalize(it.str))

  // best contiguous window of items vs. the query sentence
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
  if (best.score < 0.32) return []

  // one rect per text line within the winning run
  const lines: HighlightRect[] = []
  for (let k = best.from; k <= best.to; k++) {
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

/** Union bounding box (for the dimming spotlight ring). */
function unionRect(rects: HighlightRect[]): HighlightRect {
  const x1 = Math.min(...rects.map((r) => r.x))
  const y1 = Math.min(...rects.map((r) => r.y))
  const x2 = Math.max(...rects.map((r) => r.x + r.w))
  const y2 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x1 - 6, y: y1 - 6, w: x2 - x1 + 12, h: y2 - y1 + 12 }
}

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

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const baseSizeRef = useRef({ w: 0, h: 0 }) // page size at scale 1
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(0) // 0 = initial fit pending
  const [pageInput, setPageInput] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const t = useT()
  const [highlights, setHighlights] = useState<{ nonce: number; rects: HighlightRect[] }>({
    nonce: 0,
    rects: []
  })
  const appliedHighlightRef = useRef(0)
  const clickStartRef = useRef<{ x: number; y: number } | null>(null)

  // 'height' (default: whole page visible) | 'width' | null (manual zoom)
  const fitModeRef = useRef<'height' | 'width' | null>('height')

  const fitTo = useCallback((mode: 'height' | 'width'): void => {
    const wrap = wrapRef.current
    const { w, h } = baseSizeRef.current
    if (!wrap || !w || !h) return
    fitModeRef.current = mode
    const target =
      mode === 'height' ? (wrap.clientHeight - 36) / h : (wrap.clientWidth - 48) / w
    setScale(Math.min(3, Math.max(0.3, +target.toFixed(3))))
  }, [])

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
        fitTo('height')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      void docRef.current?.destroy()
      docRef.current = null
      baseSizeRef.current = { w: 0, h: 0 }
      fitModeRef.current = 'height'
      setTotalPages(0)
      setScale(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.pdfPath])

  // render current page
  useEffect(() => {
    setPageInput(String(currentPage))
    const doc = docRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas || totalPages === 0 || scale === 0) return
    const page = Math.min(Math.max(currentPage, 1), totalPages)
    let cancelled = false
    void (async () => {
      try {
        const pdfPage = await doc.getPage(page)
        if (cancelled) return
        renderTaskRef.current?.cancel()
        const viewport = pdfPage.getViewport({ scale: scale * window.devicePixelRatio })
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${viewport.width / window.devicePixelRatio}px`
        canvas.style.height = `${viewport.height / window.devicePixelRatio}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const task = pdfPage.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
      } catch (err) {
        // cancellation is expected when pages change quickly
        if (!cancelled && !(err instanceof Error && err.name === 'RenderingCancelledException')) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentPage, scale, totalPages])

  const go = useCallback(
    (page: number): void => {
      if (totalPages === 0) return
      setPage(Math.min(Math.max(page, 1), totalPages))
    },
    [totalPages, setPage]
  )

  // ----- trackpad / wheel page flipping -----
  const wheelStateRef = useRef({ accY: 0, accX: 0, lastFlip: 0 })
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage

  const onWheel = useCallback(
    (e: React.WheelEvent): void => {
      const el = wrapRef.current
      if (!el || totalPages < 2) return
      const st = wheelStateRef.current
      const now = Date.now()
      if (now - st.lastFlip < 450) return

      const flip = (dir: 1 | -1): void => {
        st.lastFlip = now
        st.accY = 0
        st.accX = 0
        go(currentPageRef.current + dir)
        el.scrollTop = dir === 1 ? 0 : el.scrollHeight
      }

      // horizontal two-finger swipe
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        st.accX += e.deltaX
        if (st.accX > 150) flip(1)
        else if (st.accX < -150) flip(-1)
        return
      }
      // vertical scroll: flip when the page can't scroll further
      const canScroll = el.scrollHeight > el.clientHeight + 4
      const atTop = el.scrollTop <= 1
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if (!canScroll || (e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop)) {
        st.accY += e.deltaY
        if (st.accY > 160) flip(1)
        else if (st.accY < -160) flip(-1)
      } else {
        st.accY = 0
      }
    },
    [go, totalPages]
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
        case ' ':
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

  // ----- clicking the page reveals its summary section on the right -----
  // a section "owns" a page in proportion to how often its summary actually
  // cites it ([p:N] anchors count more than coarse plan page ranges), so the
  // most-specific section wins instead of a broad overview section
  const onCanvasClick = useCallback((): void => {
    if (!plan) return
    const page = currentPageRef.current
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
      // nearest section that starts at or before this page
      const before = scored
        .filter((s) => s.minPage <= page)
        .sort((a, b) => b.minPage - a.minPage)
      target = before[0]?.step ?? plan.steps[0]
    }
    if (target) revealStep(target.id)
  }, [plan, revealStep])

  // ----- spotlight the region a clicked summary sentence came from -----
  useEffect(() => {
    const req = highlightRequest
    const doc = docRef.current
    if (!req || !doc || req.nonce === appliedHighlightRef.current) return
    if (req.page !== currentPage || scale === 0) return
    appliedHighlightRef.current = req.nonce
    let cancelled = false
    void (async () => {
      try {
        const page = await doc.getPage(req.page)
        const rects = await findHighlightRects(page, scale, req.query)
        if (!cancelled && rects.length > 0) {
          setHighlights({ nonce: req.nonce, rects })
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
  }, [highlightRequest, currentPage, scale])

  const separate = settings?.windowMode === 'separate'

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
            { label: t('menu.fitH'), onClick: () => fitTo('height') },
            { label: t('menu.fitW'), onClick: () => fitTo('width') },
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
        onWheel={onWheel}
        onMouseDown={(e) => {
          clickStartRef.current = { x: e.clientX, y: e.clientY }
        }}
        onClick={(e) => {
          // ignore drags/pans — only treat stationary clicks as "reveal"
          const start = clickStartRef.current
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return
          onCanvasClick()
        }}
      >
        {error ? (
          <div className="error-banner">{t('pdf.openFailed')}: {error}</div>
        ) : (
          <div className="canvas-holder">
            <canvas ref={canvasRef} />
            {highlights.rects.length > 0 && (
              <div
                key={`ring-${highlights.nonce}`}
                className="pdf-spot-ring"
                style={(() => {
                  const u = unionRect(highlights.rects)
                  return { left: u.x, top: u.y, width: u.w, height: u.h }
                })()}
              />
            )}
            {highlights.rects.map((r, i) => (
              <div
                key={`${highlights.nonce}-${i}`}
                className="pdf-spot-line"
                style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
