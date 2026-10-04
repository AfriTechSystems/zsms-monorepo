/**
 * Who this account is linked to, and at which school.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * ## Why a screen and not just the switcher
 *
 * The switcher answers "which child am I looking at". This answers "which children does
 * ZSMS think are mine", which is a different question and the one somebody asks when a
 * child is missing. A parent with three children at two schools, one of whom was
 * enrolled last week and has not appeared, needs somewhere that admits it.
 *
 * ## It explains linking, because that is the usual fault
 *
 * A parent is matched to their children on the **verified email address their school
 * recorded at enrolment** — `claim_parent_links()` takes no arguments and reads the
 * token, precisely so nobody can claim an address they do not own. When a child is
 * missing it is almost always that the school has a different address on file, and the
 * remedy is at the school office rather than in this app.
 */

import type { JSX } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { UserPlus, Users } from 'lucide-react-native'

import {
  Body,
  Caption,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  Title,
  usePalette,
} from '../../../components/ui'
import { useChild, type Child } from '../../../lib/child'
import { useApi } from '../../../lib/use-api'
import { SPACE, TAP, TYPE } from '../../../theme'

interface Payload {
  children: Child[]
}

export default function ParentChildren(): JSX.Element {
  const c = usePalette()
  const { childId, setChildId } = useChild()
  const { data, loading, error, reload } = useApi<Payload>('/api/parent/schools')

  const kids = data?.children ?? []

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.md, paddingBottom: SPACE.xxl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Loading your children" />}

        {data && kids.length === 0 && (
          <Empty
            icon={UserPlus}
            title="No children linked"
            body="Your school links your account using the email address they recorded when your child was enrolled. If nothing appears, ask the school office to check that address against the one you signed up with."
          />
        )}

        {kids.length > 0 && (
          <>
            <Title>Your children</Title>
            {kids.map((child) => {
              const selected = childId ? child.id === childId : child === kids[0]
              return (
                <Card key={child.id}>
                  <Row gap={SPACE.sm}>
                    <Users size={19} color={c.primaryMark} strokeWidth={2} />
                    <View style={{ flex: 1 }}>
                      <Text style={[TYPE.body, { color: c.text, fontWeight: '600' }]}>
                        {child.firstName} {child.lastName}
                      </Text>
                      <Caption>
                        {child.schoolName ?? 'School name unavailable'}
                        {child.studentId ? ` · ${child.studentId}` : ''}
                      </Caption>
                    </View>
                  </Row>

                  {/* Choosing here is the same choice the switcher makes, because the
                      selection is shared — somebody who picks a child here finds that
                      child selected on fees and results too. */}
                  {!selected && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setChildId(child.id)}
                      style={{ minHeight: TAP, justifyContent: 'center' }}
                    >
                      <Text style={[TYPE.body, { color: c.primaryText, fontWeight: '600' }]}>
                        Show this child
                      </Text>
                    </Pressable>
                  )}
                </Card>
              )
            })}

            {/* The usual fault, stated where somebody looks when a child is missing. */}
            <Body muted>
              A child missing from this list means your school has a different email
              address on file. Ask the office to update it to the address you use here.
            </Body>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}
