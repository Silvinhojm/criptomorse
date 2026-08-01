# RI-BANK-12 — Relatório do Estágio 1 (Codex)

```text
DOCUMENT_KIND=EXECUTION_REPORT
STATUS=BLOQUEADO — AGUARDANDO CONFIRMAÇÃO DO SILVIO
CODE_CHANGE_AUTHORIZED=PARCIAL
CODE_CHANGE_PERFORMED=NO
EXECUTION_AUTHORIZED=NO
REAL_TRADES_EXECUTED=NO
TEST_TRADES_EXECUTED=NO
DATE=2026-07-31
SOURCE_MANDATE=RI-BANK-12 — MANDATO: MODELO DE DUAS CAIXAS DE RISCO
DEPENDENCY_STATUS=RI-BANK-11-EXECUTION-REPORT-CLAUDE-CODE.md NÃO LOCALIZADO NO REPOSITÓRIO
```

## Destaques obrigatórios

As três perguntas da seção 3 continuam pendentes. O código anterior ao RI-BANK-12 não determina as respectivas políticas com confiança suficiente. O arquivo não rastreado `lib/risk-boxes.ts` contém respostas já implementadas, mas ele próprio é a implementação em avaliação e não pode servir como confirmação independente das decisões que o mandato proibiu tomar unilateralmente.

Também foi encontrado trabalho RI-BANK-12 preexistente e não commitado em `lib/risk-boxes.ts`, `lib/security/ri-bank-12-risk-boxes-verification.test.ts`, `lib/corretor.ts` e `lib/kv.ts`. Este relatório não altera nem endossa esse trabalho.

Não executei a suíte encontrada. Seu comando recomendado carrega `.env.local`, enquanto `lib/risk-boxes.ts` persiste em Redis quando o KV está configurado. Isso violaria a exigência de testes exclusivamente em memória/mock.

## Estágio 1 — mapeamento

### Extensão ou reescrita

O modelo deve ser um módulo complementar ao circuit breaker global, preservando a interface de segurança já usada pelo caminho real. Não é adequado converter diretamente `CircuitBreakerState` nas duas caixas:

- `lib/circuit-breaker.ts:102` mantém um estado global com pânico, perdas consecutivas, saúde de rotas e drawdown agregado.
- `lib/circuit-breaker.ts:248` serializa `recordTradeResult()` no processo; esse padrão pode ser reutilizado, mas não resolve por si só concorrência entre instâncias.
- `lib/trading-budget.ts` é ortogonal: limita exposição por janela e deixa `dailyLimitUsd=null` até D3. Não deve ser usado como saldo ou baseline das caixas.
- Um módulo dedicado para as caixas é coerente, desde que o Coordinator/Policy/Adapter receba uma decisão explícita de qual caixa financia cada ordem e que a persistência seja atômica.

### Caminho real atual

O gate de configuração preexistente está antes do swap em `lib/corretor.ts:159`, e `realSwap.executeSwap()` aparece em `lib/corretor.ts:174`. Essa ordem estrutural é correta, mas insuficiente:

- `podeOperar()` (`lib/risk-boxes.ts:194`) só verifica se a configuração básica existe.
- `caixaA.esgotada` nunca é consultada por esse gate.
- Não existe gate pré-execução que recuse uso da Caixa B quando `investir=false`.
- `registrarPerdaCaixaA()`, `registrarPerdaCaixaB()` e `registrarLucroCaixaB()` não são chamados pelo caminho de settlement em `lib/corretor.ts`; portanto, os limites das caixas não recebem resultados econômicos reais.
- O código ainda não atribui cada ordem a A ou B. Sem essa atribuição, não é possível provar qual caixa deve ser debitada, qual limite deve bloquear o swap ou onde registrar o resultado.

Conclusão: há um gate órfão de configuração, mas ainda não há um modelo de duas caixas integrado ao caminho econômico real.

## Perguntas bloqueantes

### Pergunta 1 — zerar B afeta A?

Pendente de confirmação de produto. `lib/risk-boxes.ts:225-243` já implementa B zerando isoladamente, mas isso é justamente uma escolha que o mandato proibiu consolidar sem confirmação. O circuit breaker global não fornece precedente suficiente porque sua semântica é “pausar tudo”, diferente da independência por caixa.

Cenário a confirmar: o mesmo settlement/evento de mercado cruza simultaneamente o piso de A e o limite de B. A opção tecnicamente mais literal ao modelo proposto é avaliar cada caixa de forma independente; uma pausa global adicional exige regra explícita.

### Pergunta 2 — estado temporariamente inválido para imediatamente?

Pendente. O código encontrado não expõe operação para definir risco/toggle como `null`; logo, o teste atual não reproduz o exemplo do mandato. `lib/security/ri-bank-12-risk-boxes-verification.test.ts` apenas executa setters de valores válidos e observa `podeOperar()`, o que não prova o comportamento durante uma atualização em duas etapas ou falha parcial de persistência.

É necessário decidir entre uma atualização atômica de configuração (recomendável, sem estado `null` publicável) e um modelo que publica `null` durante edição. Se `null` puder ser observado pelo executor, o princípio fail-closed sugere parar imediatamente, mas essa política precisa de confirmação.

### Pergunta 3 — mainnet apenas ou também testnet?

O precedente existente é mainnet-only para drawdown: `lib/circuit-breaker.ts:287` só calcula drawdown quando `!state.isTestnet`; `setTestnetMode()` usa limites globais relaxados para outros freios. Esse precedente descreve o modelo global antigo, não decide automaticamente o escopo das novas caixas.

`lib/risk-boxes.ts:216` e `lib/risk-boxes.ts:231` já escolheram mainnet-only, mas novamente isso é implementação RI-BANK-12, não evidência anterior. Confirmação necessária.

## Premissas adicionais ainda não confirmadas

- Caixa A usar `valorPrincipal` fixo como denominador é coerente com “lucro vai para B”, mas mudanças de aporte, retirada e reconfiguração do principal ainda não têm semântica definida.
- O baseline de B do mandato parece ser fixado na reconfiguração mais recente ou no primeiro lucro após zerar. `lib/risk-boxes.ts:263-268` o transforma em high-water mark a cada lucro adicional, interpretação adicional não autorizada pelo texto.
- Alternar `investir=false -> true` preserva o risco percentual antigo no módulo atual. É preciso confirmar se isso conta como escolha explícita vigente ou se o cliente deve escolher novamente.

## Avaliação dos testes encontrados

| Exigência | Estado | Evidência/limitação |
|---|---|---|
| Gate antes de `executeSwap()` | Parcial | Estruturalmente presente em `lib/corretor.ts:159-174`, mas não avalia caixa esgotada nem origem do capital. |
| Caixa A abaixo/acima do limite | Isolado apenas | Testa a máquina em memória, não o settlement nem o bloqueio real subsequente. |
| B `investir=false` recusa trade | Não comprovado | O teste registra uma perda e zera B depois; não prova recusa antes de `executeSwap()`. |
| B `investir=true` abaixo/acima | Isolado apenas | Não integrado ao caminho real. |
| A3 toggle no meio da sessão | Parcial | Exercita reset escolhido pela implementação, mas não uma configuração atômica/falha parcial. |
| A3 B zera e recebe novo lucro | Isolado apenas | Exercita o estado local; política de baseline ainda pendente. |
| A4b reproduzida antes da correção | Não atendido | A suíte só testa o módulo já serializado; não contém reprodução pré-fix exigida pelo mandato. |
| Testes só em memória/mock | Não garantido | Com `.env.local`, `persist()` pode escrever no Redis real. |

## Bugs/riscos novos encontrados

1. **Crítico — limites não bloqueiam o caminho real.** `caixaA.esgotada` não participa de `podeOperar()`, e não existe autorização por caixa antes do swap.
2. **Crítico — resultados não alimentam as caixas.** Lucros e perdas de settlement não chamam as funções de registro do módulo.
3. **Alto — teste de B desligada mede o efeito errado.** Zerar saldo após uma perda não equivale a impedir que o trade use B.
4. **Alto — persistência de snapshot inteiro não é atômica entre instâncias.** A fila local impede interleaving somente dentro do processo; dois runtimes podem sobrescrever o mesmo objeto Redis.
5. **Alto — baseline high-water mark foi introduzido sem autorização.** Lucro adicional modifica o denominador apesar de o mandato listar dois eventos específicos de baseline.
6. **Médio — setters aceitam principal negativo/não finito e não definem reset de perdas após novo aporte/retirada.**
7. **Médio — a suíte não possui reset isolado e recomenda carregar `.env.local`; o resultado pode depender de estado persistido e pode mutar infraestrutura externa.**

## Condição para avançar

Após confirmação explícita das perguntas 1-3 e das semânticas de baseline/aporte, o Estágio 2 deve:

1. definir configuração atômica e versionada;
2. definir `boxId`/fonte de capital por ordem antes da execução;
3. criar autorização pré-trade específica para A e B;
4. registrar lucro/perda a partir de settlement canônico, não de mero dispatch;
5. usar persistência atômica/controle de versão entre instâncias;
6. reproduzir A4b em uma implementação vulnerável isolada antes de validar a correção;
7. executar toda a suíte com KV e rede substituídos por mocks explícitos.

Nenhum commit ou push foi feito: o worktree já contém numerosas alterações preexistentes e não relacionadas, e consolidá-las sem delimitação arriscaria incluir trabalho do usuário fora deste mandato.
