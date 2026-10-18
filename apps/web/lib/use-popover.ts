'use client'

/**
 * One implementation of "a panel hanging off a button".
 *
 * Spec: `.claude/skills/zsms-ui/SKILL.md` → *Reach for the existing primitive first*
 *       WAI-ARIA Authoring Practices → Menu Button, Disclosure
 *
 * ## Why this exists
 *
 * `account-menu.tsx`, `notification-bell.tsx` and `school-switcher.tsx` each wrote
 * their own copy of the same thing: an `open` flag, a wrapper ref, a `mousedown`
 * listener for outside clicks and a `keydown` listener for Escape. Three copies, and
 * they had already drifted — the school switcher drew its panel at `z-40` while the
 * other two used `z-50`, which is only visible when two of them are open at once.
 *
 * None of the three returned focus to its trigger on close. Press Escape on an open
 * account menu and focus went to the document body, so the next Tab started from the
 * top of the page. For a keyboard user that is the difference between a menu and a
 * trapdoor.
 *
 * ## A menu must NOT trap focus, and that is a correction
 *
 * The obvious reading — "the modal traps focus, these do not, therefore give them a
 * trap" — is wrong, and worth writing down because it is the change somebody will
 * propose again.
 *
 * `ui/dialog.tsx` is built on the native `<dialog>` element precisely so the platform
 * does the trapping, and that is right **for a modal**: it is a separate context, and
 * the page behind it is inert. A menu button's panel is not modal. WAI-ARIA's menu
 * button pattern has Tab move out of the menu and on to the next control in the page,
 * closing the menu behind it. Trapping would mean a user who opens the notification
 * bell by accident cannot Tab away from it.
 *
 * So the contract here is: **Escape closes and gives focus back; Tab closes and lets
 * focus go where it was going; a click outside closes.** That is a smaller change
 * than a focus trap and the correct one.
 *
 * ## What this deliberately does not do
 *
 * No positioning, no portal, no arrow-key roving. The three call sites position their
 * own panels with the layout each needs, and their contents differ enough — a
 * radiogroup and sections, a list, a search field — that a component taking `children`
 * would have to make layout decisions for all three. This is a hook so the markup
 * stays where it can be read.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

export interface PopoverApi {
  /** Whether the panel is showing. */
  open: boolean
  /** Open, close, or toggle. Closing always restores focus to the trigger. */
  setOpen: (next: boolean) => void
  toggle: () => void
  /** Put this on the element wrapping BOTH trigger and panel — outside-click is measured against it. */
  wrapRef: React.RefObject<HTMLDivElement | null>
  /** Spread onto the trigger button. */
  triggerProps: {
    ref: React.RefObject<HTMLButtonElement | null>
    'aria-expanded': boolean
    'aria-haspopup': 'menu' | 'dialog' | 'listbox' | 'true'
    'aria-controls': string | undefined
    onClick: () => void
  }
  /** Spread onto the panel element. */
  panelProps: {
    id: string
    onKeyDown: (event: React.KeyboardEvent) => void
  }
}

export function usePopover(
  haspopup: 'menu' | 'dialog' | 'listbox' | 'true' = 'menu',
): PopoverApi {
  const [open, setOpenState] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelId = useId()

  /*
    Closing returns focus to the trigger, but only when focus is currently INSIDE the
    panel. Without that condition, a click on some other part of the page would close
    the menu and then yank focus back to a button the user has just navigated away
    from — stealing focus is the opposite of the bug being fixed.
  */
  const setOpen = useCallback((next: boolean) => {
    setOpenState((was) => {
      if (was && !next) {
        const inside = wrapRef.current?.contains(document.activeElement)
        if (inside) triggerRef.current?.focus()
      }
      return next
    })
  }, [])

  const toggle = useCallback(() => setOpen(!open), [open, setOpen])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    /*
      Escape is listened for on the document rather than the panel, because focus may
      legitimately still be on the trigger — the user opened the menu and changed their
      mind without pressing anything inside it.
    */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])

  /*
    Tab out closes. Checked on the next tick because `relatedTarget` is not reliable
    across every browser for this, and because focus has not moved yet when keydown
    fires. If focus has genuinely left the wrapper, the panel should not still be open
    behind it.
  */
  const onPanelKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      window.setTimeout(() => {
        if (!wrapRef.current?.contains(document.activeElement)) setOpenState(false)
      }, 0)
    },
    [],
  )

  return {
    open,
    setOpen,
    toggle,
    wrapRef,
    triggerProps: {
      ref: triggerRef,
      'aria-expanded': open,
      'aria-haspopup': haspopup,
      'aria-controls': open ? panelId : undefined,
      onClick: toggle,
    },
    panelProps: {
      id: panelId,
      onKeyDown: onPanelKeyDown,
    },
  }
}
