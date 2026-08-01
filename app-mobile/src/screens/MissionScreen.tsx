import React, { useEffect, useState } from "react"
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Switch } from "react-native"

// Everything imported below comes ONLY from lib/adapters/education/core/ --
// the pure engine built in Stage 2. This screen never imports
// education-adapter.ts, the Coordinator, or anything from
// lib/agent-framework/*. That boundary is what makes this screen runnable
// fully offline: no Coordinator, no Policy Engine, no Audit, no network --
// just the deterministic core, exactly as designed in the Stage 1 report.
import { evaluateMissionAction, isActionAffordable, lastTrajectoryStepId } from "../education-core/mission-engine"
import { createSimulatedWallet, applyMissionOutcome } from "../education-core/simulated-wallet"
import type { MissionOutcome, MissionScenario, PlayerAction, SimulatedWalletId, SimulatedWalletState } from "../education-core/types"

import { loadWalletState, saveWalletState } from "../engine/offline-store"

const PLAYER_WALLET_ID = "local-player" as SimulatedWalletId

function centsToReais(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  return `${sign}R$ ${(abs / 100).toFixed(2).replace(".", ",")}`
}

/**
 * Translates the pure core's (English, technical) affordability rejection
 * reasons -- see isActionAffordable() in mission-engine.ts -- into
 * player-facing Portuguese. The core's reason strings are not touched; this
 * mapping lives entirely in the UI layer, so the core stays free of any
 * display/localization concern.
 */
function friendlyAffordabilityReason(reason: string): string {
  if (reason.includes("must be positive")) return "Digite um valor maior que zero para investir."
  if (reason.includes("exceeds wallet balance")) return "Esse valor é maior do que o seu saldo simulado atual."
  return "Não foi possível usar esse valor. Tente um valor diferente."
}

const LESSON_TEXT: Record<MissionOutcome["lessonCode"], string> = {
  LOST_TO_HYPE_NO_RESEARCH: "Você entrou na dica sem pesquisar e perdeu dinheiro. Esquemas de \"pump and dump\" contam exatamente com isso.",
  LOST_TO_HYPE_DESPITE_RESEARCH: "Mesmo pesquisando antes, você decidiu entrar e perdeu dinheiro do mesmo jeito -- o mercado não perdoa por ter pesquisado. A pesquisa deveria ter mudado a decisão, não só a informação.",
  AVOIDED_BY_RESEARCH: "Você pesquisou, reconheceu os sinais de alerta e recusou. Foi exatamente assim que deveria funcionar.",
  AVOIDED_BY_INSTINCT_NO_RESEARCH: "Você recusou por instinto, sem pesquisar. Bom resultado -- mas vale desenvolver o hábito de pesquisar mesmo quando o instinto já diz não.",
  RESEARCHED_AND_INVESTED_WITH_REASON: "Você pesquisou e decidiu investir com base em informação real, não hype.",
}

type Step = "loading" | "decision" | "result"

type MissionScreenProps = {
  readonly scenario: MissionScenario
  /** Optional: when provided, a "back to menu" link is shown above the title. */
  readonly onBack?: () => void
}

export default function MissionScreen({ scenario, onBack }: MissionScreenProps): React.JSX.Element {
  const suggestedAmountReais = String(scenario.suggestedTipAmountCents / 100)

  const [step, setStep] = useState<Step>("loading")
  const [wallet, setWallet] = useState<SimulatedWalletState | null>(null)
  const [amountReais, setAmountReais] = useState(suggestedAmountReais)
  const [research, setResearch] = useState(false)
  const [outcome, setOutcome] = useState<MissionOutcome | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadWalletState().then((saved) => {
      if (cancelled) return
      setWallet(saved ?? createSimulatedWallet(PLAYER_WALLET_ID, scenario.startingBalanceCents))
      // Defensive re-assignment: guarantees the suggested amount is
      // populated by the time the decision step actually renders,
      // regardless of any earlier render timing. Harmless no-op if the
      // initial useState value above already held.
      setAmountReais(suggestedAmountReais)
      setStep("decision")
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.scenarioId])

  function resolveAction(kind: "ACCEPT" | "DECLINE"): PlayerAction {
    const exitStepId = lastTrajectoryStepId(scenario) as any // Rota Simples: always the last scripted step
    if (kind === "DECLINE") {
      return research ? { kind: "RESEARCH_THEN_DECLINE", hintsViewed: [] } : { kind: "DECLINE" }
    }
    const amountCents = Math.round(Number(amountReais.replace(",", ".")) * 100)
    return research
      ? { kind: "RESEARCH_THEN_ACCEPT", amountCents, leverageMultiplier: 1, exitStepId, hintsViewed: [] }
      : { kind: "ACCEPT_TIP", amountCents, leverageMultiplier: 1, exitStepId }
}

  async function handleDecision(kind: "ACCEPT" | "DECLINE"): Promise<void> {
    if (!wallet) return
    setErrorMsg(null)
    const action = resolveAction(kind)

    const affordable = isActionAffordable(wallet, action)
    if (!affordable.affordable) {
      setErrorMsg(friendlyAffordabilityReason(affordable.reason))
      return
    }

    const resolvedAt = Date.now() // impure app layer -- never inside core/
    const result = evaluateMissionAction(scenario, wallet, action, resolvedAt)
    const updatedWallet = applyMissionOutcome(wallet, result)

    setOutcome(result)
    setWallet(updatedWallet)
    setStep("result")
    await saveWalletState(updatedWallet) // best-effort local persistence, no network involved
  }

  function handlePlayAgain(): void {
    setOutcome(null)
    setErrorMsg(null)
    setStep("decision")
  }

  if (step === "loading" || !wallet) {
    return (
      <View style={styles.center}>
        <Text>Carregando progresso salvo...</Text>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {onBack && (
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>‹ Voltar para o menu de missões</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.title}>{scenario.title}</Text>
      <Text style={styles.narrative}>{scenario.narrative}</Text>
      <Text style={styles.balance}>Saldo simulado: {centsToReais(wallet.balanceCents)}</Text>

      {step === "decision" && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Quanto você investiria? (sugestão: {centsToReais(scenario.suggestedTipAmountCents)})</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={amountReais}
            onChangeText={setAmountReais}
            placeholder="Valor em reais"
          />

          <View style={styles.row}>
            <Text style={styles.sectionLabel}>Pesquisar antes de decidir</Text>
            <Switch value={research} onValueChange={setResearch} />
          </View>

          {research && scenario.camiGuidance && (
            <View style={styles.camiCard}>
              <Text style={styles.camiName}>Cami</Text>
              <Text style={styles.camiText}>{scenario.camiGuidance.introText}</Text>
              <Text style={styles.camiText}>{scenario.camiGuidance.returnText}</Text>
              {scenario.camiGuidance.flags.map((flag) => (
                <Text key={flag} style={styles.hint}>• {flag}</Text>
              ))}
              {scenario.camiGuidance.mode === "DIRECT" && scenario.camiGuidance.verdictText && (
                <Text style={styles.camiVerdict}>{scenario.camiGuidance.verdictText}</Text>
              )}
            </View>
          )}

          {research && !scenario.camiGuidance && (
            <View style={styles.hints}>
              {scenario.researchHintsAvailable.map((hint) => (
                <Text key={String(hint)} style={styles.hint}>• {String(hint).replace(/-/g, " ")}</Text>
              ))}
            </View>
          )}

          {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

          <TouchableOpacity style={[styles.button, styles.acceptButton]} onPress={() => handleDecision("ACCEPT")}>
            <Text style={styles.buttonText}>Aceitar a dica e investir</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.declineButton]} onPress={() => handleDecision("DECLINE")}>
            <Text style={styles.buttonText}>Recusar</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === "result" && outcome && (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Relatório de risco e aprendizado</Text>
          <Text style={styles.resultLine}>Resultado financeiro (fictício): {centsToReais(outcome.financialResultCents)}</Text>
          <Text style={styles.resultLine}>Reserva preservada: {centsToReais(outcome.reservePreservedCents)}</Text>
          <Text style={styles.resultLine}>Pesquisou antes de decidir: {outcome.researchPerformed ? "Sim" : "Não"}</Text>
          <Text style={styles.resultLine}>Reconhecimento de risco: {outcome.riskRecognition}</Text>
          <Text style={styles.lesson}>{LESSON_TEXT[outcome.lessonCode]}</Text>

          <TouchableOpacity style={[styles.button, styles.acceptButton]} onPress={handlePlayAgain}>
            <Text style={styles.buttonText}>Jogar de novo</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 20, gap: 12 },
  backLink: { fontSize: 14, color: "#2f6f4f", fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700" },
  narrative: { fontSize: 16, color: "#333" },
  balance: { fontSize: 16, fontWeight: "600", marginTop: 4 },
  card: { marginTop: 16, gap: 10 },
  sectionLabel: { fontSize: 15, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  hints: { backgroundColor: "#f2f2f2", padding: 10, borderRadius: 8 },
  hint: { fontSize: 13, color: "#555" },
  camiCard: { backgroundColor: "#eef6f2", padding: 12, borderRadius: 8, gap: 6, borderWidth: 1, borderColor: "#cfe3d8" },
  camiName: { fontSize: 14, fontWeight: "700", color: "#2f6f4f" },
  camiText: { fontSize: 13, color: "#333" },
  camiVerdict: { fontSize: 13, fontWeight: "600", color: "#2f6f4f", marginTop: 4, fontStyle: "italic" },
  error: { color: "#b00020" },
  button: { padding: 14, borderRadius: 8, alignItems: "center" },
  acceptButton: { backgroundColor: "#2f6f4f" },
  declineButton: { backgroundColor: "#8a8a8a" },
  buttonText: { color: "#fff", fontWeight: "600" },
  resultLine: { fontSize: 15 },
  lesson: { fontSize: 15, fontStyle: "italic", marginTop: 8 },
})
