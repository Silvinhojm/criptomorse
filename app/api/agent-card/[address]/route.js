export async function GET(request, context) {
  const { address } = await context.params;

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: "Endereco invalido" }, { status: 400 });
  }

  const agentCard = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "CriptoMorse Agent " + address.slice(0, 6),
    description: "Autonomous agent on CriptoMorse-Arc platform.",
    services: [{ name: "web", endpoint: "https://criptomorse-arc.vercel.app" }],
    paymentAddress: address,
    paymentTokens: ["USDC", "EURC"],
    chainId: 8453,
    version: "1.0.0"
  };

  return Response.json(agentCard);
}