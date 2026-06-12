# 🧪 Teste Local - Correção de Saldo

## Passo 1: Entender as Mudanças

### Antes (Problema):
```typescript
// Sempre usava Arc, independente da rede selecionada
const balance = await realSwap.getBalance("USDC");
```

### Depois (Corrigido):
```typescript
// 1️⃣ Mudar de rede quando detectar mudança no MetaMask
realSwap.switchNetwork("polygon");

// 2️⃣ Obter saldo da rede atual
const balance = await realSwap.getBalance("USDC");

// 3️⃣ OU obter saldo de uma rede específica
const balancePoly = await realSwap.getBalance("USDC", "polygon");
const balanceArc = await realSwap.getBalance("USDC", "arc");
```

---

## Passo 2: Testar no Console do Navegador

1. Abra seu projeto no VS Code
2. Execute: `npm run dev`
3. Abra a aba **Developer Tools** (F12)
4. Vá para **Console**
5. Cole este código:

```javascript
// Teste 1: Verificar rede atual
console.log("🔍 Rede atual:", realSwap.getNetwork());

// Teste 2: Mudar para Polygon
console.log("🔄 Mudando para Polygon...");
realSwap.switchNetwork("polygon");
console.log("✅ Rede agora:", realSwap.getNetwork());

// Teste 3: Obter saldo da Polygon
console.log("⏳ Carregando saldo Polygon...");
realSwap.getBalance("USDC").then(balance => {
  console.log("💰 Saldo USDC Polygon:", balance);
});

// Teste 4: Voltar para Arc
console.log("🔄 Voltando para Arc...");
realSwap.switchNetwork("arc");
console.log("✅ Rede agora:", realSwap.getNetwork());

// Teste 5: Obter saldo da Arc
console.log("⏳ Carregando saldo Arc...");
realSwap.getBalance("USDC").then(balance => {
  console.log("💰 Saldo USDC Arc:", balance);
});
```

---

## Passo 3: Testar com MetaMask (Teste Real)

### 3a. Na sua página React/Next.js, adicione este hook:

Crie um arquivo `lib/useNetworkDetection.ts`:

```typescript
import { useEffect } from "react";
import { realSwap } from "./real-swap-executor";

export function useNetworkDetection() {
  useEffect(() => {
    if (!window.ethereum) {
      console.warn("MetaMask não detectado");
      return;
    }

    // Mapear chainId para networkKey
    const chainIdToNetwork: Record<number, keyof typeof NETWORKS> = {
      5042002: "arc",      // Arc Testnet
      137: "polygon",      // Polygon
      8453: "base",        // Base
      1: "ethereum",       // Ethereum (se suportado)
    };

    // Detectar mudança de rede
    const handleChainChanged = (chainIdHex: string) => {
      const chainId = parseInt(chainIdHex, 16);
      const networkKey = chainIdToNetwork[chainId];

      if (networkKey) {
        console.log(`🔄 Rede mudou para: ${chainId} (${networkKey})`);
        realSwap.switchNetwork(networkKey);
        
        // Chamar callback para atualizar UI
        window.dispatchEvent(new CustomEvent("networkChanged", { detail: networkKey }));
      } else {
        console.warn(`⚠️ Rede ${chainId} não suportada`);
      }
    };

    window.ethereum.on("chainChanged", handleChainChanged);

    // Cleanup
    return () => {
      window.ethereum?.removeListener("chainChanged", handleChainChanged);
    };
  }, []);
}
```

### 3b. Use em seu componente principal:

```tsx
import { useNetworkDetection } from "@/lib/useNetworkDetection";

export default function Page() {
  useNetworkDetection(); // Detectar mudanças de rede

  return (
    <div>
      {/* Seu código aqui */}
    </div>
  );
}
```

### 3c. Quando buscar saldo, use:

```tsx
const [balance, setBalance] = useState(0);

useEffect(() => {
  // Listener para atualizar quando rede mudar
  const handleNetworkChange = (e: Event) => {
    console.log("Rede mudou, recarregando saldo...");
    loadBalance();
  };

  const loadBalance = async () => {
    const bal = await realSwap.getBalance("USDC");
    setBalance(bal);
  };

  loadBalance();
  window.addEventListener("networkChanged", handleNetworkChange);

  return () => window.removeEventListener("networkChanged", handleNetworkChange);
}, []);
```

---

## Passo 4: Teste Prático

### Cenário 1: Testar na Arc Testnet
1. ✅ Conecte MetaMask à **Arc Testnet**
2. ✅ Recarregue a página
3. ✅ Verifique no console: `console.log(realSwap.getNetwork())` → deve ser `"arc"`
4. ✅ Carregue saldo: `realSwap.getBalance("USDC")` → deve mostrar seu saldo real

### Cenário 2: Testar na Polygon
1. ✅ Mude MetaMask para **Polygon Mainnet**
2. ✅ A página deve detectar e mudar automaticamente
3. ✅ Verifique no console: `console.log(realSwap.getNetwork())` → deve ser `"polygon"`
4. ✅ Carregue saldo: `realSwap.getBalance("USDC")` → deve mostrar seu saldo real em Polygon

### Cenário 3: Testar troca rápida
1. ✅ Mude de Arc → Polygon → Arc novamente
2. ✅ Verifique se os saldos mudaram corretamente
3. ✅ Não deve ficar congelado em zero

---

## Passo 5: Verificar Logs

No Console do navegador, você deve ver:
- ✅ `🔄 RealSwapExecutor mudou para: Polygon Mainnet`
- ✅ `💰 Saldo USDC Polygon: 123.45`

---

## Próximos Passos Se Tudo Funcionar

1. Integrar `useNetworkDetection` em seu layout principal
2. Adicionar listener de mudança de rede em suas dashboards
3. Fazer commit da mudança: `git add -A && git commit -m "fix: saldo zero ao mudar de rede"`

---

## Ajuda?
Se algo não funcionar, compartilhe:
- ❌ Mensagem de erro do console
- ❌ Qual rede está usando
- ❌ Se tem USDC naquela rede
