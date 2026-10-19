/**
 * Switching between a parent's children.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * ## Why it is always visible, not in a menu
 *
 * Every number on a parent screen belongs to one child. A parent reading "K450
 * outstanding" must be able to see at a glance whose it is, and a selector hidden
 * behind a tap is one somebody forgets they changed. It sits above the content on
 * every tab.
 *
 * ## It renders nothing for one child
 *
 * A parent with a single child does not need a chooser with one option in it. Hidden
 * entirely rather than shown disabled: the latter is a control that does nothing,
 * which invites tapping.
 */

import type { JSX } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { Avatar } from './avatar'
import { Row, usePalette } from './ui'
import { RADIUS, SPACE, TAP, TYPE } from '../theme'
import type { Child } from '../lib/child'

export function ChildSwitcher({
  children,
  selectedId,
  onSelect,
}: {
  children: Child[]
  selectedId: string | null
  onSelect: (id: string) => void
}): JSX.Element | null {
  const c = usePalette()

  if (children.length < 2) return null

  // Only when the family actually spans schools. Telling a parent whose children are
  // all at one school which school each attends is noise on every screen.
  const spansSchools = new Set(children.map((k) => k.schoolId)).size > 1

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: SPACE.sm,
        paddingHorizontal: SPACE.gutter,
        paddingVertical: SPACE.sm,
      }}
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
        backgroundColor: c.surface,
        flexGrow: 0,
      }}
    >
      {children.map((child) => {
        // Before the first payload lands nothing is chosen, so the first child reads as
        // selected — which is what the server will have returned anyway.
        const active = selectedId ? child.id === selectedId : child === children[0]

        return (
          <Pressable
            key={child.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(child.id)}
            style={{
              minHeight: TAP,
              justifyContent: 'center',
              paddingHorizontal: SPACE.md,
              borderRadius: RADIUS.full,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: active ? c.primary : c.border,
              backgroundColor: active ? c.primaryTint : c.surface,
            }}
          >
            {/*
              A face on the chip, so switching between children is recognising rather
              than reading. Small on purpose — the chip has to stay thumb-sized and a
              row of large avatars would scroll off a narrow phone.
            */}
            <Row gap={SPACE.xs}>
              <Avatar
                name={`${child.firstName} ${child.lastName ?? ''}`.trim()}
                src={child.photoUrl ?? null}
                size="sm"
              />
              <Text
                style={[
                  TYPE.label,
                  { color: active ? c.primaryMark : c.text, fontWeight: active ? '700' : '500' },
                ]}
              >
                {child.firstName}
              </Text>
            </Row>
            {spansSchools && child.schoolName && (
              <Text style={[TYPE.caption, { color: c.textSubtle }]} numberOfLines={1}>
                {child.schoolName}
              </Text>
            )}
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
