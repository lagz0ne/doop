import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { gesture } from './gesture'

/** How long a finger rests in place before a context menu opens. Radix's own
 *  long press is 700 ms and is only cancelled by a move over the trigger
 *  itself, so a pan across a frame (the stage captures the pointer) opened
 *  the frame's menu mid-pan, and a finger that paused while reading did too.
 *  A menu on a phone is the deliberate gesture, so it waits well past the
 *  platform's long press (about 500 ms on iOS and Android). */
export const TOUCH_HOLD_MS = 1600
/** how far a resting finger may drift (CSS px) and still be holding */
const HOLD_SLOP = 10

/** the contextmenu events a hold sent, which are let through to Radix */
const sent = new WeakSet<Event>()
/** presses a trigger nearer the finger already holds, so the triggers that
 *  wrap it (a frame inside the stage) do not start a hold of their own */
const claimed = new WeakSet<Event>()

/**
 * A long touch press opens a Radix context menu after TOUCH_HOLD_MS instead
 * of Radix's 700 ms. Wire both handlers on the trigger's child, before the
 * child's own logic: `onPointerDown` replaces Radix's timer (Radix skips a
 * press that is defaultPrevented), and `blocks` turns away the browser's own
 * long-press contextmenu (Android) so only the hold opens the menu. The hold
 * ends when the finger lifts, drifts, or a second finger lands (a pinch);
 * the mouse and its right-click are untouched.
 */
export function useTouchHold(): {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  blocks: (e: ReactMouseEvent<HTMLElement>) => boolean
} {
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.pointerType === 'mouse' || claimed.has(e.nativeEvent)) return
    claimed.add(e.nativeEvent)
    e.preventDefault()
    stop.current?.()
    if (!e.isPrimary) return
    const { pointerId, clientX, clientY } = e
    const trigger = e.currentTarget
    const pressed = e.target instanceof Element ? e.target : trigger

    const timer = window.setTimeout(() => {
      end()
      if (gesture.pinching || !trigger.isConnected) return
      /* the press's own target, so the trigger reads what the finger is on
         (a frame's title or its surface) as a right-click there would */
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX, clientY })
      sent.add(menu)
      holdStill(pointerId)
      ;(pressed.isConnected ? pressed : trigger).dispatchEvent(menu)
    }, TOUCH_HOLD_MS)
    function onMove(ev: PointerEvent) {
      if (ev.pointerId === pointerId && Math.hypot(ev.clientX - clientX, ev.clientY - clientY) > HOLD_SLOP) end()
    }
    function onOther(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) end()
    }
    function onUp(ev: PointerEvent) {
      if (ev.pointerId === pointerId) end()
    }
    function end() {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onOther)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      stop.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onOther)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    stop.current = end
  }

  function blocks(e: ReactMouseEvent<HTMLElement>): boolean {
    if (sent.has(e.nativeEvent)) return false
    const type = (e.nativeEvent as Partial<PointerEvent>).pointerType
    if (type !== 'touch' && type !== 'pen' && !stop.current) return false
    e.preventDefault()
    return true
  }

  return { onPointerDown, blocks }
}

/** The finger that opened a menu stays down: whatever it started (a pan)
 *  holds still until it lifts, so the canvas does not slide under the menu. */
function holdStill(pointerId: number) {
  gesture.held = pointerId
  function release(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return
    gesture.held = null
    window.removeEventListener('pointerup', release, true)
    window.removeEventListener('pointercancel', release, true)
  }
  window.addEventListener('pointerup', release, true)
  window.addEventListener('pointercancel', release, true)
}
