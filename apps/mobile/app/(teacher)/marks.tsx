/**
 * Marks — not built in this pass.
 *
 * Spec: `Official Documentation/11 Examinations and Results/RESULTS.md`
 *
 * The tab exists because the bar is part of the shell and an app whose navigation grows
 * between releases feels unfinished in a way a stated "not yet" does not. It says what is
 * coming and where to do it today, rather than rendering an empty list that reads as a
 * fault.
 */

import type { JSX } from 'react'
import { ScrollView } from 'react-native'
import { ClipboardList } from 'lucide-react-native'

import { Empty, Screen } from '../../components/ui'
import { SPACE } from '../../theme'

export default function Marks(): JSX.Element {
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: SPACE.gutter }}>
        <Empty
          icon={ClipboardList}
          title="Marks entry is coming"
          body="Attendance is first because it has to be marked daily and cannot be reconstructed later. Enter marks on the ZSMS website for now."
        />
      </ScrollView>
    </Screen>
  )
}
