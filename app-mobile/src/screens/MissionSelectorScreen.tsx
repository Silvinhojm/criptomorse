import React from "react"
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native"

// Same boundary as MissionScreen.tsx: only reads from education-core/, never
// education-adapter.ts or lib/agent-framework/*.
import { ALL_SCENARIOS } from "../education-core/scenario-catalog"
import type { MissionScenario } from "../education-core/types"

type MissionSelectorScreenProps = {
  readonly onSelect: (scenario: MissionScenario) => void
}

export default function MissionSelectorScreen({ onSelect }: MissionSelectorScreenProps): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Escolha uma missão</Text>
      <View style={styles.list}>
        {ALL_SCENARIOS.map((scenario) => (
          <TouchableOpacity
            key={String(scenario.scenarioId)}
            style={styles.missionButton}
            onPress={() => onSelect(scenario)}
          >
            <Text style={styles.missionButtonText}>{scenario.title}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  list: { gap: 12 },
  missionButton: { padding: 16, borderRadius: 8, backgroundColor: "#2f6f4f", alignItems: "center" },
  missionButtonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
})
