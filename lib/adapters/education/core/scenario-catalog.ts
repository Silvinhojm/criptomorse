import type { MissionScenario, MissionId, ScenarioId, SimulatedAssetId, ResearchHintId, PriceStepId } from "./types"

/**
 * "A dica do amigo" -- the mission chosen as the first vertical slice.
 * A scripted pump-and-dump / rug-pull trajectory: the promised 10x never
 * happens, so any ACCEPT_TIP / RESEARCH_THEN_ACCEPT exiting at the last
 * step (Rota Simples) deterministically loses money.
 */
export const FRIEND_TIP_SCENARIO: MissionScenario = {
  scenarioId: "friend-tip-10x" as ScenarioId,
  missionId: "mission-001" as MissionId,
  title: "A dica do amigo",
  narrative: "Você recebeu R$ 2.500. Um amigo recomenda investir R$ 1.500 em uma moeda que promete multiplicar por dez.",
  startingBalanceCents: 250_000,
  suggestedTipAmountCents: 150_000,
  asset: {
    assetId: "fake-coin-x10" as SimulatedAssetId,
    displayName: "MoedaX",
    promisedMultiplier: 10,
    // Trajectory calibrated to documented real-market statistics, not an
    // arbitrary narrative choice (RI-EDU-2 Stage 2 addendum,
    // 2026-07-25): hype=1.6 (PumpSense, arXiv 2605.09431 -- pumps above
    // 60% in minutes are the documented pattern); peak=2.44 (median pump
    // increase for meme coins is +143.95%, "A Midsummer Meme's Dream",
    // arXiv 2507.01963); rugpull=0.17, i.e. -83% (within the >80% loss
    // band reported for 17.58% of real cases in the same study -- severe
    // but not statistically extraordinary). promisedMultiplier=10 is left
    // unchanged: it is the friend's narrative claim, not a market
    // datum -- and is itself the lesson, since even the real median peak
    // (2.44x) falls far short of a promised 10x.
    priceTrajectory: [
      { stepId: "entry" as PriceStepId, label: "Preço de entrada", priceMultiplier: 1.0 },
      { stepId: "hype" as PriceStepId, label: "Sobe rápido, todo mundo comenta", priceMultiplier: 1.6 },
      { stepId: "peak" as PriceStepId, label: "Pico — influencers postando", priceMultiplier: 2.44 },
      { stepId: "rugpull" as PriceStepId, label: "Liquidez retirada pelo criador", priceMultiplier: 0.17 },
    ],
    liquidationThreshold: 0.5,
  },
  researchHintsAvailable: [
    "hint-whitepaper-inexistente" as ResearchHintId,
    "hint-time-anonima" as ResearchHintId,
    "hint-sem-liquidez" as ResearchHintId,
  ],
  // Same 3 warning signs as researchHintsAvailable above, presented as
  // Cami's mentor narrative instead of a raw list (RI-EDU-2 Cami Guidance
  // specification, 2026-07-25). Purely presentational -- see types.ts.
  camiGuidance: {
    mode: "DIRECT",
    introText: "Cami desce até a caverna do mercado para investigar essa moeda antes de você decidir...",
    returnText: "Cami volta da caverna com o que encontrou:",
    flags: [
      "whitepaper inexistente",
      "time anônima",
      "sem liquidez",
    ],
    verdictText: "Veredito do Cami: isso tem cara de esquema, não de projeto real. Eu não arriscaria meu saldo aqui -- mas a decisão final é sua.",
  },
}

/**
 * "A Alta Repentina" -- Mission 2 (RI-EDU-3), Volatility/FOMO. No
 * third-party promise here (no `promisedMultiplier`) -- the lure is the
 * player's own FOMO reaction to a real, already-happened 22% rally, not a
 * tip from someone else. Correction magnitude (-15%) is the mid-point of
 * the documented 10-20% post-rally correction range, not an extreme case.
 * Cami mode DIRECT: still the 2nd mission, guided support retained.
 */
export const SUDDEN_RALLY_SCENARIO: MissionScenario = {
  scenarioId: "sudden-rally-fomo" as ScenarioId,
  missionId: "mission-002" as MissionId,
  title: "A Alta Repentina",
  narrative: "Você recebeu R$ 2.500. WXCoin subiu 22% nas últimas 3 horas e está em todas as redes sociais. Comprar agora parece garantia de lucro rápido.",
  startingBalanceCents: 250_000,
  suggestedTipAmountCents: 100_000,
  asset: {
    assetId: "wxcoin" as SimulatedAssetId,
    displayName: "WXCoin",
    priceTrajectory: [
      { stepId: "entry" as PriceStepId, label: "Preço atual (já subiu 22% nas últimas 3 horas)", priceMultiplier: 1.0 },
      { stepId: "correction" as PriceStepId, label: "Correção típica após alta acelerada", priceMultiplier: 0.85 },
    ],
    liquidationThreshold: 0.5,
  },
  researchHintsAvailable: [
    "hint-alta-sem-noticia" as ResearchHintId,
    "hint-volume-social-atipico" as ResearchHintId,
    "hint-carteiras-novas" as ResearchHintId,
  ],
  camiGuidance: {
    mode: "DIRECT",
    introText: "Cami olha o gráfico dessa alta antes de você decidir...",
    returnText: "Cami voltou com o que notou:",
    flags: [
      "alta técnica sem nenhuma notícia nova relevante",
      "volume de menções em redes sociais muito acima da média",
      "maioria das compras recentes veio de carteiras novas, sem histórico",
    ],
    verdictText: "Veredito do Cami: correções depois de altas rápidas como essa são o padrão, não a exceção. Não é golpe, é só o ritmo normal do mercado -- mas comprar bem no topo raramente compensa.",
  },
}

/**
 * "O Dump da Baleia" -- Mission 3 (RI-EDU-3), market manipulation via
 * concentrated ownership. Drop magnitude (-65%) reflects that 50%+ crashes
 * on concentrated-holder sell-offs are a real, documented pattern, though
 * exact magnitude varies by case -- this is severe but not the genre's
 * extreme. First scenario using Cami mode FLAGS_ONLY (no verdictText): per
 * Silvio's "more guided early, more open later" progression, guidance
 * narrows starting with the 3rd mission.
 */
export const WHALE_DUMP_SCENARIO: MissionScenario = {
  scenarioId: "whale-dump-manipulation" as ScenarioId,
  missionId: "mission-003" as MissionId,
  title: "O Dump da Baleia",
  narrative: "Você recebeu R$ 2.500. WYToken vem subindo de forma estável há semanas. Uma única carteira detém 42% de todo o fornecimento -- e não existe nenhuma trava impedindo essa carteira de vender tudo quando quiser.",
  startingBalanceCents: 250_000,
  suggestedTipAmountCents: 80_000,
  asset: {
    assetId: "wytoken" as SimulatedAssetId,
    displayName: "WYToken",
    priceTrajectory: [
      { stepId: "entry" as PriceStepId, label: "Preço estável, subindo aos poucos", priceMultiplier: 1.0 },
      { stepId: "whale_dump" as PriceStepId, label: "A carteira concentrada vendeu tudo de uma vez", priceMultiplier: 0.35 },
    ],
    liquidationThreshold: 0.5,
  },
  researchHintsAvailable: [
    "hint-concentracao-42-porcento" as ResearchHintId,
    "hint-sem-vesting" as ResearchHintId,
    "hint-movimento-para-exchange" as ResearchHintId,
  ],
  camiGuidance: {
    mode: "FLAGS_ONLY",
    introText: "Cami investigou a distribuição de posse desse token antes de você decidir...",
    returnText: "Cami voltou com o que encontrou (sem dar veredito desta vez -- você decide):",
    flags: [
      "uma única carteira concentra 42% do fornecimento",
      "nenhuma trava (vesting) sobre essa carteira",
      "grande volume recente movido dessa carteira para uma exchange",
    ],
    // No verdictText -- FLAGS_ONLY mode does not include one.
  },
}

export const ALL_SCENARIOS: readonly MissionScenario[] = [FRIEND_TIP_SCENARIO, SUDDEN_RALLY_SCENARIO, WHALE_DUMP_SCENARIO]
