// src/app/api/agent-card/[address]/route.js
// Serve o agent card JSON no formato ERC-8004 registration-v1
// URL: /api/agent-card/0x...

export async function GET(request, { params }) {
  const { address } = params;

  // Validação básica de endereço ETH
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: "Endereço inválido" }, { status: 400 });
  }

  // Agent card no formato oficial ERC-8004 registration-v1
  const agentCard = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `CriptoMorse Agent ${address.slice(0, 6)}`,
    description:
      "Autonomous agent on the CriptoMorse-Arc platform. " +
      "Executes onchain jobs with USDC/EURC payments and ERC-8183 escrow.",
    image: `https://criptomorse-arc.vercel.app/api/avatar/${address}`,
    services: [
      {
        name: "A2A",
        endpoint: "https://criptomorse-arc.vercel.app/api/a2a",
      },
      {
        name: "web",
        endpoint: `https://criptomorse-arc.vercel.app/agent/${address}`,
      },
    ],
    paymentAddress: address,
    paymentTokens: ["USDC", "EURC"],
    chainId: 8453,
    trustModels: ["reputation", "escrow"],
    registeredAt: new Date().toISOString(),
    version: "1.0.0",
  };

  return Response.json(agentCard, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
