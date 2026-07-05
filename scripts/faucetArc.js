// scripts/faucetArc.js
// Solicita tokens da faucet Circle para Arc Testnet via API do projeto
// Uso: node scripts/faucetArc.js <endereco>
// Exemplo: node scripts/faucetArc.js 0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894

const ADDRESS = process.argv[2] || '0x77f5C3A1079B86ef8490E7c5Ec1F9bcfbaAE5894';

async function requestFaucet(token, address) {
  const resp = await fetch('https://faucet.circle.com/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation RequestToken($input: RequestTokenInput!) { requestToken(input: $input) { status amount hash explorerLink } }`,
      variables: { input: { destinationAddress: address, token, blockchain: 'ARC' } }
    })
  });
  return resp.json();
}

(async () => {
  const tokens = ['USDC', 'EURC', 'CIRBTC'];
  for (const token of tokens) {
    console.log(`Solicitando ${token}...`);
    try {
      const r = await requestFaucet(token, ADDRESS);
      const status = r?.data?.requestToken?.status || 'erro';
      const hash = r?.data?.requestToken?.hash || '';
      console.log(`  → ${token}: ${status} ${hash ? hash.slice(0, 20) + '...' : '(sem hash)'}`);
    } catch (e) {
      console.log(`  → ${token}: erro de conexão`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('\nSe falhar, abra https://faucet.circle.com/ no navegador e resolva o captcha manualmente.');
})();
