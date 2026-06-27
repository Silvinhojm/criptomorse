// scripts/faucetArc.js
// Tenta solicitar tokens da faucet Circle para Arc Testnet
const ADDRESS = '0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894';

async function requestFaucet(token, address, blockchain) {
  const resp = await fetch('https://faucet.circle.com/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'recaptcha-token': 'test-bypass',
      'recaptcha-action': 'request_token',
    },
    body: JSON.stringify({
      query: `mutation RequestToken($input: RequestTokenInput!) { requestToken(input: $input) { status amount hash explorerLink } }`,
      variables: { input: { destinationAddress: address, token, blockchain } }
    })
  });
  return resp.json();
}

(async () => {
  const tokens = ['USDC', 'EURC', 'CIRBTC'];
  for (const token of tokens) {
    console.log(`Solicitando ${token}...`);
    const r = await requestFaucet(token, ADDRESS, 'ARC');
    console.log(JSON.stringify(r, null, 2) + '\n');
    await new Promise(r => setTimeout(r, 2000));
  }
})();
