import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconMore } from './icons'

export interface PaneMenuItem {
  type?: 'item' | 'separator'
  label?: string
  detail?: string
  disabled?: boolean
  checked?: boolean
  onClick?: () => void
}

/** Closes the popover on outside click / Escape. */
export function useDismiss(open: boolean, close: () => void): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

/** Generic anchored popover (used by the ⋯ menu and the steps list). */
export function Popover({
  trigger,
  open,
  setOpen,
  children,
  align = 'right'
}: {
  trigger: ReactNode
  open: boolean
  setOpen: (v: boolean) => void
  children: ReactNode
  align?: 'left' | 'right'
}): JSX.Element {
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div className="popover-anchor" ref={ref}>
      {trigger}
      {open && <div className={`popover ${align}`}>{children}</div>}
    </div>
  )
}

/** VSCode-style overflow (⋯) menu for a pane header. */
export default function PaneMenu({ items, title }: { items: PaneMenuItem[]; title?: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      setOpen={setOpen}
      trigger={
        <button
          className={`icon-btn ${open ? 'active' : ''}`}
          title={title ?? '옵션'}
          onClick={() => setOpen(!open)}
        >
          <IconMore />
        </button>
      }
    >
      <div className="menu-list">
        {items.map((item, i) =>
          item.type === 'separator' ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button
              key={i}
              className="menu-item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick?.()
              }}
            >
              <span className="check">{item.checked ? '✓' : ''}</span>
              <span className="label">{item.label}</span>
              {item.detail && <span className="detail">{item.detail}</span>}
            </button>
          )
        )}
      </div>
    </Popover>
  )
}
