// 🧪 CONSOLE TEST - Cole isso no DevTools (F12 > Console)

console.log("=== 🧪 TESTE DE SALDO ===");

// ✅ Teste 1: Verificar rede atual
console.log("1️⃣ Rede atual:");
console.log(`   ${realSwap.getNetwork()}`);

// ✅ Teste 2: Obter saldo USDC da rede atual
console.log("2️⃣ Carregando saldo USDC...");
realSwap.getBalance("USDC").then(balance => {
  console.log(`   ✅ Saldo USDC: $${balance.toFixed(4)}`);
}).catch(err => {
  console.error(`   ❌ Erro: ${err.message}`);
});

// ✅ Teste 3: Obter saldo EURC da rede atual
console.log("3️⃣ Carregando saldo EURC...");
realSwap.getBalance("EURC").then(balance => {
  console.log(`   ✅ Saldo EURC: ${balance.toFixed(4)}`);
}).catch(err => {
  console.error(`   ❌ Erro: ${err.message}`);
});

// ✅ Teste 4: Testar mudança de rede
console.log("\n4️⃣ Testando mudança de rede...");
console.log("   Mudando para Polygon...");
realSwap.switchNetwork("polygon");
console.log(`   ✅ Rede agora: ${realSwap.getNetwork()}`);

// ✅ Teste 5: Obter saldo da Polygon
console.log("5️⃣ Carregando saldo USDC da Polygon...");
realSwap.getBalance("USDC").then(balance => {
  console.log(`   ✅ Saldo USDC Polygon: $${balance.toFixed(4)}`);
}).catch(err => {
  console.error(`   ❌ Erro: ${err.message}`);
});

// ✅ Teste 6: Voltar para Arc
console.log("\n6️⃣ Voltando para Arc...");
realSwap.switchNetwork("arc");
console.log(`   ✅ Rede agora: ${realSwap.getNetwork()}`);

console.log("\n✅ Testes completados! Veja os resultados acima.");
console.log("\n📌 Próximo passo: Mude de rede no MetaMask e veja se o console detecta.");
