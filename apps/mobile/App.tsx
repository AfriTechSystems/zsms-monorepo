import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { getCountryConfig } from '@zsms/config'

/**
 * Phase 0 scaffold.
 *
 * The teacher attendance flow — offline-first via PowerSync — is built in
 * Phase 2 (BUILD_SEQUENCE.md). Offline attendance is a core requirement
 * (ADR-004) and the single most valuable availability control in the system,
 * not a later port of the web app.
 */
export default function App() {
  const country = getCountryConfig()
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ZSMS</Text>
      <Text>
        {country.name} ({country.code})
      </Text>
      <Text style={styles.note}>Phase 0 scaffold</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600' },
  note: { marginTop: 8, opacity: 0.6 },
})
