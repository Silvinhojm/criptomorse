# RI-BANK-32 — adaptador AWS KMS para EVM e prova real na Arc Testnet

**Data:** 2026-08-03
**Resultado:** APROVADO
**Endereço KMS:** `0x88993E37Ed022C56F83f67C74d33C783E8e49C75`

## Resumo executivo

O `KmsEvmSigner` foi implementado e provado em três níveis:

1. teste determinístico local com KMS sintético: DER, low-S, recovery e serialização EIP-1559;
2. chamada real em produção Vercel por OIDC → STS → AWS KMS, recuperando exatamente o endereço esperado;
3. uma transação EIP-1559 real, de valor zero, assinada pelo KMS e confirmada na Arc Testnet.

Evidência final:

- tx: `0x342ddcbd1347c7e8b4bdbc584511c6f668badaab2135236657a34895231ce8b5`
- bloco: `55117565`
- status: `1` (sucesso)
- gas usado: `21000`
- from/to: `0x88993E37Ed022C56F83f67C74d33C783E8e49C75`
- value: `0`
- explorer: https://testnet.arcscan.app/tx/0x342ddcbd1347c7e8b4bdbc584511c6f668badaab2135236657a34895231ce8b5

Nenhuma mainnet, trade, cron ou integração com execução econômica foi realizada.

## Estágio 1 — abordagem técnica

### DER → r, s, v

O KMS recebe o hash EVM de 32 bytes com `MessageType=DIGEST` e `SigningAlgorithm=ECDSA_SHA_256`; nesse modo ele assina o digest fornecido. A resposta ECDSA vem em ASN.1 DER.

Conversão adotada:

1. `@noble/curves@1.9.1` decodifica DER em `r` e `s`;
2. `normalizeS()` aplica low-S (`s <= n/2`), conforme EIP-2;
3. `ethers.Signature` testa `yParity=0` e `yParity=1`;
4. `ethers.recoverAddress()` escolhe a paridade que recupera o endereço esperado;
5. o adaptador expõe `v=27/28` e a assinatura serializada.

Isso evita um parser ASN.1 próprio. Noble é uma implementação auditada e a versão `1.9.1` preserva compatibilidade com Circle App Kit.

Referências:

- AWS KMS Sign: https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html
- AWS KMS key specs: https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html
- EIP-2: https://eips.ethereum.org/EIPS/eip-2
- ethers v6 crypto: https://docs.ethers.org/v6/api/crypto/
- Noble Curves: https://github.com/paulmillr/noble-curves

### Vercel OIDC → STS → KMS

1. a Function obtém o token efêmero com `getVercelOidcToken()`;
2. `fromWebToken()` chama STS `AssumeRoleWithWebIdentity`;
3. o SDK recebe credenciais AWS temporárias;
4. `KMSClient` usa essas credenciais para `GetPublicKey` e `Sign`.

Nenhuma AWS access key, secret, session token, token OIDC ou private key foi persistido.

Referências:

- Vercel OIDC: https://vercel.com/docs/oidc
- Vercel → AWS: https://vercel.com/docs/oidc/aws
- STS: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html

## Estágio 2 — implementação e testes

Arquivos:

- `lib/kms/kms-evm-signer.ts`
- `lib/kms/vercel-oidc-kms.ts`
- `lib/security/ri-bank-32-kms-evm-signer.test.ts`
- `app/api/internal/ri-bank-32-kms-proof/route.ts`

Controles fail-closed:

- exige `ECC_SECG_P256K1`, `SIGN_VERIFY` e `ECDSA_SHA_256`;
- deriva o endereço do SPKI de `GetPublicKey` e bloqueia se divergir;
- aceita somente digest de 32 bytes e verifica recovery local;
- rota somente `POST`, production-only, bearer dedicado e `no-store`;
- transação restrita a chainId `5042002`, self-transfer de valor zero e nonce fixo;
- nonce `0` agora está consumido, bloqueando nova transação de teste.

Teste local:

```text
ALL_RI_BANK_32_LOCAL_ASSERTIONS_PASSED=YES
DERIVED_TEST_ADDRESS=0xD808CF130e3b1cA6B4D87D026009174E066F9830
```

O endereço acima pertence somente à chave sintética do teste.

Build: Next.js 15.5.19, compilação e 31 páginas concluídas, exit code `0` (warnings preexistentes).

### Prova real sem blockchain

Deployment: `dpl_5mJWhbuWrvKmzf2t65Wm8mj4MHVi`

```json
{
  "ok": true,
  "address": "0x88993E37Ed022C56F83f67C74d33C783E8e49C75",
  "addressMatches": true,
  "digest": "0x5bd3fb2ed46c3c7ca4cbc4f82ccfcb4bf79579a7f9e46a0fef2cbd4eaba44f8a",
  "yParity": 1,
  "v": 28
}
```

## Estágio 3 — faucet e transação real

Faucet oficial Circle:

- 20 USDC de testnet;
- tx `0x325ec3ce4ae521545a6b0bc9334b7a87e5679faf443901b2e5a2698d93ee7bf6`;
- https://testnet.arcscan.app/tx/0x325ec3ce4ae521545a6b0bc9334b7a87e5679faf443901b2e5a2698d93ee7bf6

Transação KMS:

```text
type=2
chainId=5042002
nonce=0
from=0x88993E37Ed022C56F83f67C74d33C783E8e49C75
to=0x88993E37Ed022C56F83f67C74d33C783E8e49C75
value=0
gasUsed=21000
status=1
block=55117565
tx=0x342ddcbd1347c7e8b4bdbc584511c6f668badaab2135236657a34895231ce8b5
```

O RPC público `.network` devolveu `-32011 request limit reached` no broadcast da Function. A transação raw já assinada foi validada localmente (from, chainId, nonce, to e value) e enviada sem alteração pelo endpoint `.io`, já usado no repositório. O receipt posterior confirmou `status=0x1`.

## Divergência de infraestrutura

Em 02/08 havia evidência de 11 variáveis em `arcflow`, incluindo AWS/KMS e Upstash. Em 03/08, `vercel env ls` retornou zero variáveis. Foram restauradas somente as quatro variáveis públicas KMS a partir da folha validada do RI-BANK-17. As duas variáveis isoladas usadas durante o teste foram removidas ao final, desativando a rota em deployments futuros.

Os tokens Upstash/Redis ausentes não foram inventados nem restaurados. Essa perda deve ser investigada antes de qualquer ativação de cron/trading.

## Limites preservados e conclusão

- nenhuma transação mainnet, fundo real ou trade;
- nenhuma mudança em trust policy, key policy ou role;
- nenhum signer conectado a cron, lease, Coordinator ou TradingAdapter;
- nenhuma private key exportada ou armazenada.

O mecanismo P1-C foi provado ponta a ponta: a chave não exportável no KMS assina um digest EVM, a assinatura é normalizada/recuperável e foi aceita pela Arc Testnet em uma transação real.
