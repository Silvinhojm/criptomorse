export async function GET(request, context) {
  const { address } = await context.params;

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: "Endereco invalido" }, { status: 400 });
  }

  const agentCard = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "CriptoMorse Autonomous Trading Agent",
    description:
      "Multi-agent autonomous trading platform with real-time market analysis, " +
      "cross-chain swap execution, volatility tracking, and staircase profit-taking. " +
      "Deployed on Arc Testnet — USDC-native gas, sub-second finality, opt-in privacy.",
    image: "https://criptomorse-arc.vercel.app/agent-logo.png",
    agent_type: "trading",
    capabilities: [
      "multi_agent_swarm_voting",
      "cross_chain_swap_execution",
      "volatility_adaptive_trading",
      "staircase_profit_taking",
      "onchain_job_settlement_erc8183",
      "real_time_market_data_streaming",
      "circuit_breaker_risk_management",
      "cctp_stablecoin_bridging"
    ],
    services: [
      { name: "web", endpoint: "https://criptomorse-arc.vercel.app" },
      { name: "agent_card", endpoint: `https://criptomorse-arc.vercel.app/api/agent-card/${address}` },
      { name: "agent_info", endpoint: `https://criptomorse-arc.vercel.app/api/agents/${address}` },
      { name: "market_data", endpoint: "https://criptomorse-arc.vercel.app/api/market-data" },
      { name: "price_feed", endpoint: "https://criptomorse-arc.vercel.app/api/price" }
    ],
    paymentAddress: address,
    paymentTokens: ["USDC", "EURC"],
    chainId: 5042002,
    chainName: "Arc Testnet",
    version: "2.0.0",
    software: {
      name: "CriptoMorse",
      version: "2.0.0",
      repository: "https://github.com/anomalyco/arcflow"
    },
    supported_chains: ["arc_testnet", "polygon", "ethereum", "base", "sepolia"],
    trust_model: "ERC-8004 onchain reputation + jobs completed (50+ jobs → trusted)",
    gas_token: "USDC",
    finality: "sub-second deterministic",
    privacy: "opt-in confidential transactions"
  };

  return Response.json(agentCard);
}