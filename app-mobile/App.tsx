import { useState } from "react"
import { StatusBar } from "expo-status-bar"
import { SafeAreaView, StyleSheet } from "react-native"
import MissionScreen from "./src/screens/MissionScreen"
import MissionSelectorScreen from "./src/screens/MissionSelectorScreen"
import type { MissionScenario } from "./src/education-core/types"

export default function App() {
  const [selectedScenario, setSelectedScenario] = useState<MissionScenario | null>(null)

  return (
    <SafeAreaView style={styles.root}>
      {selectedScenario ? (
        <MissionScreen
          key={String(selectedScenario.scenarioId)}
          scenario={selectedScenario}
          onBack={() => setSelectedScenario(null)}
        />
      ) : (
        <MissionSelectorScreen onSelect={setSelectedScenario} />
      )}
      <StatusBar style="auto" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },
})
