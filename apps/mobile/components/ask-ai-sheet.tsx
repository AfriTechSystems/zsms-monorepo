/**
 * Ask AI, on a phone.
 *
 * Spec: `Official Documentation/18 AI Module/AI_ASSISTANT.md`
 *
 * ## A sheet, not a panel
 *
 * The web version slides a 420px panel over the page. On a 390px screen that IS the page,
 * so this is a full-height modal with the conversation and the composer, and the history
 * reachable from the header rather than always on show.
 *
 * ## The keyboard decides the layout
 *
 * `KeyboardAvoidingView` with the composer pinned to the bottom, because a teacher asks
 * a question standing in a corridor with one thumb — and a composer that slides under the
 * keyboard makes the feature unusable rather than awkward.
 *
 * ## It does not look metered
 *
 * No counter, no balance, no mention of credits inside the daily allowance. The cap
 * surfaces only when it is reached, as a sentence about tomorrow.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { ArrowUp, Plus, Sparkles, X } from 'lucide-react-native'

import { Body, Caption, Title, usePalette } from './ui'
import { api } from '../lib/api'
import { useSession } from '../lib/auth'
import { SPACE, TYPE } from '../theme'

interface Message {
  role: 'user' | 'assistant'
  content: string
  citations?: Array<{ source: string; detail: string }>
}

interface Conversation {
  id: string
  title: string
  updatedAt: string
}

const SUGGESTIONS: Record<string, string[]> = {
  teacher: [
    "What's on my timetable today?",
    'Who is struggling in my class?',
    'How has attendance been this week?',
  ],
  parent: [
    'What do I still owe?',
    'How is my child doing this term?',
    'Has my child been attending?',
  ],
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning.'
  if (h < 17) return 'Good afternoon.'
  return 'Good evening.'
}

export function AskAiSheet({
  open,
  onClose,
  audience,
}: {
  open: boolean
  onClose: () => void
  audience: 'teacher' | 'parent'
}): JSX.Element {
  const c = usePalette()
  const { getToken } = useSession()

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [history, setHistory] = useState<Conversation[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const scrollRef = useRef<ScrollView>(null)

  // The conversation list, fetched when the sheet opens rather than at mount — a phone
  // should not spend a request on a feature nobody has tapped.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    void api
      .get<{ conversations: Conversation[] }>('/api/assistant', getToken)
      .then((r) => {
        if (!cancelled && r.data) setHistory(r.data.conversations)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [open, getToken])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return

      setDraft('')
      setNotice(null)
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
      setBusy(true)

      try {
        const result = await api.post<{
          conversationId: string
          answer: string
          citations: Array<{ source: string; detail: string }>
        }>('/api/assistant', getToken, {
          message: trimmed,
          conversationId: conversationId ?? undefined,
        })

        if (result.error) {
          /*
            The daily cap arrives as a CONFLICT and is not a failure — shown as a plain
            line, with the question put back so it is not lost.
          */
          setNotice(result.error)
          setMessages((prev) => prev.slice(0, -1))
          setDraft(trimmed)
          return
        }

        if (result.data) {
          setConversationId(result.data.conversationId)
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: result.data!.answer,
              citations: result.data!.citations,
            },
          ])
        }
      } finally {
        setBusy(false)
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)
      }
    },
    [busy, conversationId, getToken],
  )

  const suggestions = SUGGESTIONS[audience] ?? []

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: c.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ---------------- header ---------------- */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: SPACE.gutter,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <Sparkles size={18} color={c.primary} />
          <Pressable style={{ flex: 1 }} onPress={() => setHistoryOpen((v) => !v)}>
            <Text style={[TYPE.body, { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
              {history.find((h) => h.id === conversationId)?.title ?? 'Ask AI'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setConversationId(null)
              setMessages([])
              setNotice(null)
              setHistoryOpen(false)
            }}
            hitSlop={10}
            accessibilityLabel="New conversation"
          >
            <Plus size={22} color={c.textMuted} />
          </Pressable>

          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <X size={22} color={c.textMuted} />
          </Pressable>
        </View>

        {/* ---------------- history ---------------- */}
        {historyOpen && history.length > 0 && (
          <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, maxHeight: 200 }}>
            <ScrollView>
              {history.map((h) => (
                <Pressable
                  key={h.id}
                  onPress={async () => {
                    setConversationId(h.id)
                    setHistoryOpen(false)
                    const r = await api.get<{ messages: Message[] }>(
                      `/api/assistant?conversationId=${h.id}`,
                      getToken,
                    )
                    if (r.data) setMessages(r.data.messages)
                  }}
                  style={{ paddingHorizontal: SPACE.gutter, paddingVertical: 12, minHeight: 44 }}
                >
                  <Text style={[TYPE.body, { color: c.text }]} numberOfLines={1}>
                    {h.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ---------------- conversation ---------------- */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.card }}
        >
          {messages.length === 0 ? (
            <View style={{ gap: SPACE.card, paddingTop: SPACE.card }}>
              <View style={{ alignItems: 'center' }}>
                <Title>{greeting()}</Title>
                <Caption>What are we doing today?</Caption>
              </View>

              {suggestions.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => void send(s)}
                  style={{
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.surfaceSunken,
                    borderRadius: 12,
                    padding: SPACE.card,
                    minHeight: 44,
                  }}
                >
                  <Body>{s}</Body>
                </Pressable>
              ))}
            </View>
          ) : (
            messages.map((m, i) => (
              <View
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  backgroundColor: m.role === 'user' ? c.primary : c.surfaceSunken,
                  borderRadius: 12,
                  padding: SPACE.card,
                }}
              >
                <Text
                  style={[TYPE.body, { color: m.role === 'user' ? c.onPrimary : c.text }]}
                >
                  {m.content}
                </Text>

                {/* What the answer was built from — required by AI_ASSISTANT.md, and the
                    difference between a figure a parent can act on and one they cannot. */}
                {m.role === 'assistant' && (m.citations?.length ?? 0) > 0 && (
                  <View
                    style={{
                      marginTop: 8,
                      borderTopWidth: 1,
                      borderTopColor: c.border,
                      paddingTop: 6,
                    }}
                  >
                    {m.citations?.map((cit, j) => (
                      <Text key={j} style={[TYPE.caption, { color: c.textMuted }]}>
                        {cit.source} — {cit.detail}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ))
          )}

          {busy && <Caption>Thinking…</Caption>}
          {notice ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surfaceSunken,
                borderRadius: 8,
                padding: SPACE.card,
              }}
            >
              <Text style={[TYPE.body, { color: c.textMuted }]}>{notice}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* ---------------- composer ---------------- */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            padding: SPACE.gutter,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask about fees, attendance or results"
            placeholderTextColor={c.textSubtle}
            multiline
            style={{
              ...TYPE.body,
              color: c.text,
              flex: 1,
              maxHeight: 100,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          />

          <Pressable
            onPress={() => void send(draft)}
            disabled={busy || draft.trim() === ''}
            accessibilityLabel="Send"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: c.primary,
              opacity: busy || draft.trim() === '' ? 0.4 : 1,
            }}
          >
            <ArrowUp size={18} color={c.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
