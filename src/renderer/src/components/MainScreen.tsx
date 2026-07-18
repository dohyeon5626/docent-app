import { useCallback, useRef, useState } from 'react'
import type { PaneRole } from './../store/appStore'
import { useAppStore } from '../store/appStore'
import PdfViewer from './PdfViewer/PdfViewer'
import AIStudyPanel from './AIStudyPanel/AIStudyPanel'

/** Learning screen: PDF window on the left, study window on the right. */
export default function MainScreen({ pane }: { pane: PaneRole }): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const setSplitRatio = useAppStore((s) => s.setSplitRatio)

  const [dragging, setDragging] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const ratio = settings?.splitRatio ?? 0.5

  const onDividerDown = useCallback(() => {
    setDragging(true)
    const onMove = (e: MouseEvent): void => {
      const rect = splitRef.current?.getBoundingClientRect()
      if (!rect) return
      const r = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width))
      setSplitRatio(r)
    }
    const onUp = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [setSplitRatio])

  if (pane !== 'both') {
    return (
      <div className="split">
        <div className="pane" style={{ flex: 1 }}>
          {pane === 'pdf' ? <PdfViewer /> : <AIStudyPanel />}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="split" ref={splitRef}>
        <div className="pane" style={{ width: `${ratio * 100}%` }}>
          <PdfViewer />
        </div>
        <div className={`divider ${dragging ? 'dragging' : ''}`} onMouseDown={onDividerDown} />
        <div className="pane" style={{ flex: 1 }}>
          <AIStudyPanel />
        </div>
      </div>
    </>
  )
}
