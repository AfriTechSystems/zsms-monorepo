'use client'

/**
 * Ask AI — the assistant panel.
 *
 * Spec: `Official Documentation/18 AI Module/AI_ASSISTANT.md`, ADR-034, and the agreed
 *       design (2026-10-06).
 *
 * ## A panel, not a page
 *
 * It slides in from the right over whatever the user is doing, because the questions it
 * answers are about the screen behind it — "who is missing marks here", "how much is
 * left". Navigating away to ask would lose the context that makes those work.
 *
 * On a phone it is a full-height sheet instead: a 420px panel over a 390px screen is a
 * panel, and the thing behind it is not visible anyway.
 *
 * ## It does not look metered
 *
 * Inside the daily allowance there is no counter, no balance and no mention of credits —
 * confirmed on 2026-10-06, the feature should feel free. The quota only surfaces once it
 * is gone, as a plain sentence about tomorrow.
 *
 * ## Writes stop here
 *
 * A prepared action renders as a card with Confirm and Cancel and goes no further. The
 * assistant never performs one, whatever the model returned.
 *
 * ## It renders through a PORTAL, and has to
 *
 * Reported on 2026-10-06: the panel opened as "a very small box" and looked transparent.
 *
 * `AskAi` lives in the shell's `headerActions`, and that header carries `backdrop-blur`.
 * **A `backdrop-filter` ancestor creates a containing block for `position: fixed`
 * descendants** — so `fixed inset-y-0 right-0` resolved against the header's thin strip
 * instead of the viewport, and the header's `bg-surface/95` showed through around it.
 *
 * Nothing was wrong with the panel's own styling, which is why it was not obvious. A
 * portal to `document.body` takes it out of that subtree entirely, and is the only fix
 * that does not require the header to give up its blur.
 */

import type { JSX } from 'react'
import { AiAura } from './ai-aura'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react'

import { Button } from '../ui/button'
import { apiSend, useApi } from '../../lib/use-api'

interface Conversation {
  id: string
  title: string
  updatedAt: string
}

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  intent?: string | null
  route?: string | null
  citations?: Array<{ source: string; detail: string }>
  pendingAction?: Record<string, unknown> | null
  actedAt?: string | null
}

/** Suggestions, by audience. What this person can actually ask about. */
const SUGGESTIONS: Record<string, Array<{ title: string; sub: string }>> = {
  school: [
    { title: 'Fee collection', sub: 'How much have we collected this term?' },
    { title: 'Pupils at risk', sub: 'Which pupils are struggling?' },
    { title: 'Attendance', sub: 'Which classes have the worst attendance?' },
    { title: 'Marks', sub: 'Have all marks been entered?' },
  ],
  teacher: [
    { title: 'My week', sub: "What's on my timetable?" },
    { title: 'My class', sub: 'Who is struggling in my class?' },
    { title: 'Attendance', sub: 'How has attendance been this week?' },
    { title: 'Marks', sub: 'Have I entered all my marks?' },
  ],
  parent: [
    { title: 'School fees', sub: 'What do I still owe?' },
    { title: 'How is my child doing?', sub: 'Their marks this term' },
    { title: 'Attendance', sub: 'Has my child been attending?' },
    { title: 'Timetable', sub: "What's on this week?" },
  ],
}

/** A UUID anywhere in the path — the record the user currently has open. */
const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning.'
  if (h < 17) return 'Good afternoon.'
  return 'Good evening.'
}

/** "20h", "3d" — compact, like the design. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}

export function AssistantPanel({
  open,
  onClose,
  audience,
  basePath,
}: {
  open: boolean
  onClose: () => void
  /** Which suggestions to offer. */
  audience: 'school' | 'teacher' | 'parent'
  /** `/school/ZM-LSK-0001`, so navigation keeps them in their own school. */
  basePath?: string
}): JSX.Element | null {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const endRef = useRef<HTMLDivElement>(null)

  /*
    `createPortal` needs a DOM node, which does not exist during the server render. One
    tick after mount is enough, and the panel is only ever opened by a click anyway.
  */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { data, reload } = useApi<{
    conversations: Conversation[]
    quota: { userUsed: number; userLimit: number; withinFree: boolean } | null
  }>(open ? '/api/assistant' : null)

  const conversations = useMemo(() => data?.conversations ?? [], [data])

  const title = useMemo(
    () => conversations.find((c) => c.id === conversationId)?.title ?? 'New conversation',
    [conversations, conversationId],
  )

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase()
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations
  }, [conversations, historyQuery])

  // Keep the newest turn in view as answers arrive.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  // Escape closes, as it does for every other overlay in ZSMS.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (historyOpen) setHistoryOpen(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, historyOpen, onClose])

  const loadConversation = useCallback(async (id: string) => {
    setConversationId(id)
    setHistoryOpen(false)
    setBusy(true)
    try {
      const res = await fetch(`/api/assistant?conversationId=${id}`)
      const body = (await res.json().catch(() => null)) as
        | { data?: { messages?: Message[] } }
        | null
      setMessages(body?.data?.messages ?? [])
    } finally {
      setBusy(false)
    }
  }, [])

  const startNew = useCallback(() => {
    setConversationId(null)
    setMessages([])
    setNotice(null)
    setHistoryOpen(false)
  }, [])

  /**
   * Perform a prepared write.
   *
   * The request carries only the MESSAGE ID. The action itself lives on that row, so a
   * confirmation cannot carry something other than what was previewed — which is exactly
   * the failure the approval gate exists to prevent.
   */
  const confirm = useCallback(
    async (messageId: string) => {
      setConfirming(messageId)
      try {
        const result = await apiSend<{ done: boolean; message: string; route?: string }>(
          '/api/assistant/confirm',
          'POST',
          { messageId },
        )

        if (result.error) {
          setNotice(result.error)
          return
        }

        // Mark it acted-on locally so the card collapses immediately rather than after a
        // refetch — a Confirm button that stays live reads as not having worked.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, actedAt: new Date().toISOString() } : m,
          ),
        )

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.data?.message ?? 'Done.' },
        ])

        if (result.data?.route) {
          router.push(result.data.route)
          onClose()
        }
      } finally {
        setConfirming(null)
      }
    },
    [router, onClose],
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return

      setDraft('')
      setNotice(null)
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
      setBusy(true)

      try {
        const result = await apiSend<{
          conversationId: string
          answer: string
          intent: string
          kind?: string
          route: string | null
          citations: Array<{ source: string; detail: string }>
          pendingAction: Record<string, unknown> | null
        }>('/api/assistant', 'POST', {
          message: trimmed,
          conversationId: conversationId ?? undefined,
          /*
            Read from the URL rather than passed down from every screen.

            The sub-section tabs already put `?section=` in the query string and an entity
            page already carries its id in the path, so the context is there to be read —
            and requiring 67 screens to cooperate would mean the ones nobody updated
            silently lose it.
          */
          page: {
            route: pathname,
            basePath,
            section: searchParams.get('section'),
            entityId: UUID_IN_PATH.exec(pathname)?.[0] ?? null,
            filters: Object.fromEntries(
              [...searchParams.entries()].filter(([k]) => k !== 'section'),
            ),
          },
        })

        if (result.error) {
          /*
            A CONFLICT is the daily cap, not a fault. Shown as a plain sentence rather
            than a red error, because running out of a free allowance is not a failure.
          */
          setNotice(result.error)
          setMessages((prev) => prev.slice(0, -1))
          setDraft(trimmed)
          return
        }

        const d = result.data
        if (!d) return

        setConversationId(d.conversationId)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: d.answer,
            intent: d.intent,
            route: d.route,
            citations: d.citations,
            pendingAction: d.pendingAction,
          },
        ])

        /*
          A navigation answer goes there.

          Closing the panel too, because the whole point was to get somewhere — leaving it
          open over the destination would hide what the user asked to see.
        */
        if (d.route) {
          router.push(d.route)
          onClose()
        }

        reload()
      } finally {
        setBusy(false)
      }
    },
    [busy, conversationId, pathname, searchParams, basePath, router, onClose, reload],
  )

  if (!open || !mounted) return null

  // `SUGGESTIONS.school` is always present, but the index signature cannot know that.
  const suggestions = SUGGESTIONS[audience] ?? SUGGESTIONS['school'] ?? []

  return createPortal(
    <>
      {/* Backdrop. Only on small screens — on a desktop the panel sits beside the work
          rather than over it, and dimming the page would say otherwise. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 lg:hidden"
      />

      <aside
        role="dialog"
        aria-label="Ask AI"
        /*
          `bg-surface` stays, and stays SOLID. The aura is painted inside the panel
          behind its own scrim, not by making the panel translucent — a translucent
          panel would show the dashboard through it, which is what makes text hard to
          read on a busy screen.
        */
        className={`fixed inset-y-0 right-0 z-50 flex h-dvh flex-col overflow-hidden border-l border-border bg-surface shadow-2xl transition-[width] ${
          expanded ? 'w-full lg:w-[48rem]' : 'w-full sm:w-[26rem]'
        }`}
      >
        <AiAura />

        {/* ---------------- header ---------------- */}
        <header className="relative flex items-center gap-1 border-b border-border p-stack">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            className="flex min-h-tap min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left font-medium hover:bg-muted"
          >
            <span className="truncate">{title}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={startNew}
            aria-label="New conversation"
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus aria-hidden="true" className="size-5" />
          </button>

          {/* Wider, for reading a long answer. Hidden on phones, where it is already
              full width. */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Narrow the panel' : 'Widen the panel'}
            className="hidden min-h-tap min-w-tap items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:inline-flex"
          >
            {expanded ? (
              <Minimize2 aria-hidden="true" className="size-4" />
            ) : (
              <Maximize2 aria-hidden="true" className="size-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>

        {/* ---------------- history ---------------- */}
        {historyOpen && (
          <div className="relative border-b border-border p-stack">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                className="min-h-tap w-full rounded-md border border-border bg-surface pl-8 pr-2 text-sm"
              />
            </div>

            <ul className="mt-stack max-h-60 overflow-y-auto">
              {filteredHistory.length === 0 ? (
                <li className="px-1 py-2 text-sm text-muted-foreground">
                  {historyQuery ? 'Nothing matches.' : 'No conversations yet.'}
                </li>
              ) : (
                filteredHistory.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => void loadConversation(c.id)}
                      className="flex min-h-tap w-full items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {ago(c.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>

            <Button variant="outline" className="mt-stack w-full" onClick={startNew}>
              <Plus aria-hidden="true" />
              New conversation
            </Button>
          </div>
        )}

        {/* ---------------- conversation ---------------- */}
        <div className="relative flex-1 overflow-y-auto p-card">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-cards pt-cards">
              <div className="text-center">
                <p className="text-xl font-semibold">{greeting()}</p>
                <p className="text-sm text-muted-foreground">What are we doing today?</p>
              </div>

              <ul className="flex w-full flex-col gap-2">
                {suggestions.map((s) => (
                  <li key={s.title}>
                    <button
                      type="button"
                      onClick={() => void send(s.sub)}
                      className="flex min-h-tap w-full items-start gap-2 rounded-lg border border-border bg-sunken p-stack text-left transition-colors hover:bg-muted"
                    >
                      <Sparkles
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-primary"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{s.title}</span>
                        <span className="block text-sm text-muted-foreground">{s.sub}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="flex flex-col gap-cards">
              {messages.map((m, i) => (
                <li
                  key={m.id ?? i}
                  className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-sunken text-foreground'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>

                    {/*
                      What the answer was built from.

                      `AI_ASSISTANT.md` requires citations rather than bare text: a
                      narrated figure about a child or an amount that nobody can trace is
                      one nobody can act on.
                    */}
                    {m.role === 'assistant' && (m.citations?.length ?? 0) > 0 && (
                      <ul className="mt-2 border-t border-border pt-1.5">
                        {m.citations?.map((c, j) => (
                          <li key={j} className="text-xs text-muted-foreground">
                            {c.source} — {c.detail}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/*
                      A prepared write, with the exact change.

                      `AI_ASSISTANT.md` shows a table of field-level changes, not prose:
                      the person confirming must see WHICH pupil and WHAT changes, because
                      they are the last check before a parent is told their child was
                      absent.
                    */}
                    {m.pendingAction && !m.actedAt && (
                      <div className="mt-2 rounded-md border border-warning bg-warning/10 p-2">
                        <p className="text-xs font-semibold">Nothing has been saved yet.</p>

                        {Array.isArray(m.pendingAction['changes']) && (
                          <table className="mt-1.5 w-full text-xs">
                            <caption className="sr-only">Changes awaiting confirmation</caption>
                            <tbody>
                              {(
                                m.pendingAction['changes'] as Array<{
                                  name: string
                                  from: string
                                  to: string
                                }>
                              ).map((ch, k) => (
                                <tr key={k}>
                                  <td className="pr-2 font-medium">{ch.name}</td>
                                  <td className="text-muted-foreground">{ch.from}</td>
                                  <td className="px-1 text-muted-foreground" aria-label="becomes">
                                    &rarr;
                                  </td>
                                  <td className="font-medium">{ch.to}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {typeof m.pendingAction['date'] === 'string' && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {String(m.pendingAction['classId'] ?? '')} ·{' '}
                            {String(m.pendingAction['date'])}
                          </p>
                        )}

                        {typeof m.pendingAction['audienceHint'] === 'number' && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Around {String(m.pendingAction['audienceHint'])} pupils&apos;
                            families would receive this.
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={confirming === m.id || !m.id}
                            onClick={() => m.id && void confirm(m.id)}
                          >
                            {confirming === m.id ? (
                              <Loader2 aria-hidden="true" className="animate-spin" />
                            ) : (
                              <Check aria-hidden="true" />
                            )}
                            Confirm
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={confirming === m.id}
                            onClick={() =>
                              /* Discarded locally. Nothing was ever written, so there is
                                 nothing to undo — the row simply stops offering. */
                              setMessages((prev) =>
                                prev.map((x) =>
                                  x.id === m.id ? { ...x, pendingAction: null } : x,
                                ),
                              )
                            }
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              ))}
              <div ref={endRef} />
            </ul>
          )}

          {busy && (
            <p className="mt-cards flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Thinking…
            </p>
          )}

          {/* The cap, only once it is reached. Never a running counter. */}
          {notice && (
            <p className="mt-cards rounded-md border border-border bg-sunken p-stack text-sm text-muted-foreground">
              {notice}
            </p>
          )}
        </div>

        {/* ---------------- composer ---------------- */}
        <form
          className="relative border-t border-border p-stack"
          onSubmit={(e) => {
            e.preventDefault()
            void send(draft)
          }}
        >
          <div className="rounded-lg border border-border bg-surface p-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a new line. A question is usually one line,
                // and reaching for a button after every one would be slower.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(draft)
                }
              }}
              rows={2}
              placeholder="Ask about fees, attendance, results — or where to find something"
              aria-label="Ask the assistant"
              className="w-full resize-none bg-transparent text-sm outline-none"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={busy || draft.trim() === ''}
                aria-label="Send"
                className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <ArrowUp aria-hidden="true" className="size-4" />
                )}
              </button>
            </div>
          </div>

          <p className="mt-1.5 text-center text-xs text-muted-foreground">
            {/* The honest disclaimer. It reads real ZSMS data under this user's own
                permissions, and it can still misread a question. */}
            Answers come from your own ZSMS data. Check anything important.
          </p>
        </form>
      </aside>
    </>,
    document.body,
  )
}
