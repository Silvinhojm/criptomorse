import { queryPythPrice, queryPythPrices, hasPythFeed } from "../lib/pyth-price-feed";

async function main() {
  const ethPrice = await queryPythPrice("ETH");
  console.log("  ETH/USD:", ethPrice ? "$" + ethPrice.toFixed(2) : "null");

  const btcPrice = await queryPythPrice("BTC");
  console.log("  BTC/USD:", btcPrice ? "$" + btcPrice.toFixed(2) : "null");

  const usdcPrice = await queryPythPrice("USDC");
  console.log("  USDC/USD:", usdcPrice ? "$" + usdcPrice.toFixed(4) : "null");

  const eurcPrice = await queryPythPrice("EURC");
  console.log("  EURC/USD:", eurcPrice ? "$" + eurcPrice.toFixed(4) : "null");

  const polPrice = await queryPythPrice("POL");
  console.log("  POL/USD:", polPrice ? "$" + polPrice.toFixed(4) : "null");

  const batch = await queryPythPrices(["ETH", "BTC", "USDC", "EURC", "POL"]);
  console.log("  Batch:", Object.fromEntries(batch));
  console.log("  hasPythFeed(ETH):", hasPythFeed("ETH"));
  console.log("  hasPythFeed(ARC):", hasPythFeed("ARC"));
}
main().catch(console.error);
