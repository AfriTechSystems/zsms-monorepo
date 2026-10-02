/**
 * Pupils — not built in this pass.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *
 * See `marks.tsx` for why the tab exists before the screen does.
 */

import type { JSX } from 'react'
import { ScrollView } from 'react-native'
import { Users } from 'lucide-react-native'

import { Empty, Screen } from '../../components/ui'
import { SPACE } from '../../theme'

export default function Pupils(): JSX.Element {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: SPACE.gutter }}>
        <Empty
          icon={Users}
          title="Pupil look-up is coming"
          body="You will be able to search your classes and see a pupil's attendance and marks here."
        />
      </ScrollView>
    </Screen>
  )
}
