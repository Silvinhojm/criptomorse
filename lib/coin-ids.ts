// Mapeamento único de TokenSymbol → SoSoValue currency_id.
// ATUALIZE AQUI ao adicionar novo token — NUNCA duplique COIN_IDS em outro arquivo.
// Seção 14 do ARCFLOW.md lista todos os lugares que precisam ser atualizados ao adicionar token.

export const COIN_IDS: Record<string, string> = {
  WETH: "1673723677362319867",
  WMATIC: "1730847291434274818",
  WBTC: "1673723677362319866",
  USDC: "1673723677362319870",
  USDT: "1673723677362319868",
  DAI: "1673723677362319879",
  EURC: "1673723677362320241",
  ARB: "1673723677362319902",
  SOL: "1673723677362319875",
  cirBTC: "1673723677362319866",
  mcirBTC: "1673723677362319866",
  // Aliases nativos (usados em _fetchNativePrice)
  ETH: "1673723677362319867",
  POL: "1730847291434274818",
  ARC: "1673723677362319870",
};

/** Conjunto de tokens com price feed SoSoValue disponível */
export const TOKENS_WITH_FEED = new Set(Object.keys(COIN_IDS));
