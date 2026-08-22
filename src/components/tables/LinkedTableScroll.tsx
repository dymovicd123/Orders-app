import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

type LinkedTableScrollProps = {
  children: ReactNode
  className?: string
  ariaLabel?: string
}

type HorizontalDragState = {
  startX: number
  startScrollLeft: number
  moved: boolean
}

const INTERACTIVE_TARGET_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'a',
  'label',
  'summary',
  '[role="button"]',
  '[contenteditable="true"]',
].join(', ')

export function LinkedTableScroll({
  children,
  className = '',
  ariaLabel = 'Горизонтальная прокрутка таблицы',
}: LinkedTableScrollProps) {
  const tableShellRef = useRef<HTMLDivElement | null>(null)
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const syncSourceRef = useRef<'table' | 'top' | null>(null)
  const dragStateRef = useRef<HorizontalDragState | null>(null)
  const suppressClickUntilRef = useRef(0)
  const [tableWidth, setTableWidth] = useState(0)
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false)

  useLayoutEffect(() => {
    const tableShell = tableShellRef.current
    const topScroll = topScrollRef.current
    if (!tableShell || !topScroll) return undefined
    const shell = tableShell
    const topBar = topScroll

    let animationFrame = 0

    const endHorizontalDrag = () => {
      const dragState = dragStateRef.current
      if (!dragState) return

      shell.classList.remove('is-horizontal-dragging')
      document.body.classList.remove('is-horizontal-table-dragging')

      if (dragState.moved) suppressClickUntilRef.current = Date.now() + 180
      dragStateRef.current = null
      window.removeEventListener('mousemove', onHorizontalDragMove)
      window.removeEventListener('mouseup', endHorizontalDrag)
      window.removeEventListener('blur', endHorizontalDrag)
    }

    const updateGeometry = () => {
      const nextWidth = Math.max(shell.clientWidth, shell.scrollWidth)
      const nextHasOverflow = shell.scrollWidth > shell.clientWidth + 4
      setTableWidth((current) => (current === nextWidth ? current : nextWidth))
      setHasHorizontalOverflow((current) => (current === nextHasOverflow ? current : nextHasOverflow))
      shell.dataset.horizontalOverflow = nextHasOverflow ? 'true' : 'false'

      if (!nextHasOverflow) {
        endHorizontalDrag()
        shell.scrollLeft = 0
        topBar.scrollLeft = 0
      } else {
        topBar.scrollLeft = shell.scrollLeft
      }
    }

    const scheduleGeometryUpdate = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(updateGeometry)
    }

    const onTableScroll = () => {
      if (syncSourceRef.current === 'top') return
      syncSourceRef.current = 'table'
      topBar.scrollLeft = shell.scrollLeft
      syncSourceRef.current = null
    }

    const onTopScroll = () => {
      if (syncSourceRef.current === 'table') return
      syncSourceRef.current = 'top'
      shell.scrollLeft = topBar.scrollLeft
      syncSourceRef.current = null
    }

    function onHorizontalDragMove(event: MouseEvent) {
      const dragState = dragStateRef.current
      if (!dragState) return

      const deltaX = event.clientX - dragState.startX
      if (Math.abs(deltaX) > 4) dragState.moved = true
      shell.scrollLeft = dragState.startScrollLeft - deltaX

      if (dragState.moved) event.preventDefault()
    }

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      if (shell.scrollWidth <= shell.clientWidth + 4) return

      const target = event.target
      if (target instanceof Element && target.closest(INTERACTIVE_TARGET_SELECTOR)) return

      dragStateRef.current = {
        startX: event.clientX,
        startScrollLeft: shell.scrollLeft,
        moved: false,
      }
      shell.classList.add('is-horizontal-dragging')
      document.body.classList.add('is-horizontal-table-dragging')
      window.addEventListener('mousemove', onHorizontalDragMove)
      window.addEventListener('mouseup', endHorizontalDrag)
      window.addEventListener('blur', endHorizontalDrag)
      event.preventDefault()
    }

    const onClickCapture = (event: MouseEvent) => {
      if (Date.now() >= suppressClickUntilRef.current) return
      suppressClickUntilRef.current = 0
      event.preventDefault()
      event.stopPropagation()
    }

    const onDragStart = (event: DragEvent) => {
      if (shell.scrollWidth > shell.clientWidth + 4) event.preventDefault()
    }

    shell.addEventListener('scroll', onTableScroll, { passive: true })
    topBar.addEventListener('scroll', onTopScroll, { passive: true })
    shell.addEventListener('mousedown', onMouseDown)
    shell.addEventListener('click', onClickCapture, true)
    shell.addEventListener('dragstart', onDragStart)
    window.addEventListener('resize', scheduleGeometryUpdate)

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleGeometryUpdate)
      : null
    resizeObserver?.observe(tableShell)
    const table = shell.querySelector('table')
    if (table) resizeObserver?.observe(table)

    const mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(scheduleGeometryUpdate)
      : null
    mutationObserver?.observe(tableShell, { childList: true, subtree: true, characterData: true })

    scheduleGeometryUpdate()

    return () => {
      endHorizontalDrag()
      window.cancelAnimationFrame(animationFrame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('resize', scheduleGeometryUpdate)
      shell.removeEventListener('scroll', onTableScroll)
      topBar.removeEventListener('scroll', onTopScroll)
      shell.removeEventListener('mousedown', onMouseDown)
      shell.removeEventListener('click', onClickCapture, true)
      shell.removeEventListener('dragstart', onDragStart)
    }
  }, [])

  return (
    <div className={`linked-table-scroll ${hasHorizontalOverflow ? 'has-horizontal-overflow' : 'fits-horizontally'}`}>
      <div
        ref={topScrollRef}
        className="table-scrollbar-top"
        hidden={!hasHorizontalOverflow}
        aria-label={ariaLabel}
        role="region"
        tabIndex={hasHorizontalOverflow ? 0 : -1}
      >
        <div className="table-scrollbar-top-spacer" style={{ width: `${tableWidth}px` }} />
      </div>
      <div
        ref={tableShellRef}
        className={`table-shell ${className}`.trim()}
        tabIndex={hasHorizontalOverflow ? 0 : -1}
        data-horizontal-overflow={hasHorizontalOverflow ? 'true' : 'false'}
      >
        {children}
      </div>
    </div>
  )
}
