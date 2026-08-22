import { useEffect } from 'react'

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

const OVERFLOW_TOLERANCE = 4

type ManagedTableShell = {
  cleanup: () => void
  updateOverflow: () => void
}

type HorizontalDragState = {
  shell: HTMLDivElement
  startX: number
  startScrollLeft: number
  moved: boolean
  markClickSuppressed: () => void
}

/**
 * Adds the same safe mouse grab-to-scroll behaviour used by LinkedTableScroll
 * to every other overflowing .table-shell in the application.
 *
 * It deliberately does not listen to wheel or pointer events, so normal page
 * scrolling and native touch scrolling stay untouched.
 */
export function TableDragScrollManager() {
  useEffect(() => {
    const managed = new Map<HTMLDivElement, ManagedTableShell>()
    let activeDrag: HorizontalDragState | null = null
    let mutationFrame = 0

    const endHorizontalDrag = () => {
      if (!activeDrag) return
      activeDrag.shell.classList.remove('is-horizontal-dragging')
      document.body.classList.remove('is-horizontal-table-dragging')
      if (activeDrag.moved) activeDrag.markClickSuppressed()
      window.removeEventListener('mousemove', onHorizontalDragMove)
      window.removeEventListener('mouseup', endHorizontalDrag)
      window.removeEventListener('blur', endHorizontalDrag)
      activeDrag = null
    }

    function onHorizontalDragMove(event: MouseEvent) {
      if (!activeDrag) return
      const deltaX = event.clientX - activeDrag.startX
      if (Math.abs(deltaX) > OVERFLOW_TOLERANCE) activeDrag.moved = true
      activeDrag.shell.scrollLeft = activeDrag.startScrollLeft - deltaX
      if (activeDrag.moved) event.preventDefault()
    }

    const registerShell = (shell: HTMLDivElement) => {
      if (managed.has(shell)) return
      // LinkedTableScroll already owns these listeners and its mirrored top bar.
      if (shell.closest('.linked-table-scroll')) return

      let suppressClickUntil = 0
      let animationFrame = 0

      const updateOverflow = () => {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = window.requestAnimationFrame(() => {
          const hasOverflow = shell.scrollWidth > shell.clientWidth + OVERFLOW_TOLERANCE
          shell.dataset.horizontalOverflow = hasOverflow ? 'true' : 'false'
          if (!hasOverflow) {
            if (activeDrag?.shell === shell) endHorizontalDrag()
            shell.classList.remove('is-horizontal-dragging')
            shell.scrollLeft = 0
          }
        })
      }

      const onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return
        if (shell.scrollWidth <= shell.clientWidth + OVERFLOW_TOLERANCE) return
        const target = event.target
        if (target instanceof Element && target.closest(INTERACTIVE_TARGET_SELECTOR)) return

        endHorizontalDrag()
        activeDrag = {
          shell,
          startX: event.clientX,
          startScrollLeft: shell.scrollLeft,
          moved: false,
          markClickSuppressed: () => { suppressClickUntil = Date.now() + 180 },
        }
        shell.classList.add('is-horizontal-dragging')
        document.body.classList.add('is-horizontal-table-dragging')
        window.addEventListener('mousemove', onHorizontalDragMove)
        window.addEventListener('mouseup', endHorizontalDrag)
        window.addEventListener('blur', endHorizontalDrag)
        event.preventDefault()
      }

      const onClickCapture = (event: MouseEvent) => {
        if (Date.now() >= suppressClickUntil) return
        suppressClickUntil = 0
        event.preventDefault()
        event.stopPropagation()
      }

      const onDragStart = (event: DragEvent) => {
        if (shell.scrollWidth > shell.clientWidth + OVERFLOW_TOLERANCE) event.preventDefault()
      }

      const resizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateOverflow)
        : null
      resizeObserver?.observe(shell)
      const table = shell.querySelector('table')
      if (table) {
        resizeObserver?.observe(table)
      }

      const contentObserver = typeof MutationObserver !== 'undefined'
        ? new MutationObserver(updateOverflow)
        : null
      contentObserver?.observe(shell, { childList: true, subtree: true, characterData: true })

      shell.addEventListener('mousedown', onMouseDown)
      shell.addEventListener('click', onClickCapture, true)
      shell.addEventListener('dragstart', onDragStart)
      updateOverflow()

      const cleanup = () => {
        if (activeDrag?.shell === shell) endHorizontalDrag()
        window.cancelAnimationFrame(animationFrame)
        resizeObserver?.disconnect()
        contentObserver?.disconnect()
        shell.removeEventListener('mousedown', onMouseDown)
        shell.removeEventListener('click', onClickCapture, true)
        shell.removeEventListener('dragstart', onDragStart)
        delete shell.dataset.horizontalOverflow
      }

      managed.set(shell, { cleanup, updateOverflow })
    }

    const unregisterDetachedShells = () => {
      for (const [shell, entry] of managed) {
        if (shell.isConnected && !shell.closest('.linked-table-scroll')) continue
        entry.cleanup()
        managed.delete(shell)
      }
    }

    const scan = () => {
      unregisterDetachedShells()
      document.querySelectorAll<HTMLDivElement>('.table-shell').forEach(registerShell)
      for (const entry of managed.values()) entry.updateOverflow()
    }

    const scheduleScan = () => {
      window.cancelAnimationFrame(mutationFrame)
      mutationFrame = window.requestAnimationFrame(scan)
    }

    const mutationObserver = new MutationObserver(scheduleScan)
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', scheduleScan)
    scan()

    return () => {
      endHorizontalDrag()
      window.cancelAnimationFrame(mutationFrame)
      mutationObserver.disconnect()
      window.removeEventListener('resize', scheduleScan)
      for (const entry of managed.values()) entry.cleanup()
      managed.clear()
    }
  }, [])

  return null
}
