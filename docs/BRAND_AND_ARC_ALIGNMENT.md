# Alinhamento à marca Arc e governança de nome

## 1. Propósito e status

Este documento registra a intenção do projeto de cumprir as diretrizes oficiais de marca da Arc e estabelece uma governança provisória para a escolha do nome público. A revisão foi iniciada em 18 de julho de 2026, com base nas diretrizes e no anúncio publicados pela Arc em 16 de julho de 2026.

Fontes oficiais consultadas:

- Diretrizes oficiais: <https://www.arc.io/brand-guidelines-and-partner-toolkit>
- Anúncio e explicação na Arc House: <https://community.arc.io/public/blogs/arc-brand-guidelines-and-partner-toolkit-is-live-2026-07-16>

Este registro não constitui aconselhamento jurídico, aprovação da Arc ou da Circle, autorização de uso de ativos de marca nem decisão final de nome.

```text
ARC_BRAND_ALIGNMENT_INTENT=YES
ARC_GUIDELINES_REVIEW_DATE=2026-07-18
PUBLIC_BRAND_FINALIZED=NO
ARC_OR_CIRCLE_ENDORSEMENT_CLAIMED=NO
SIGNED_PARTNERSHIP_CLAIMED=NO
```

## 2. Regra central

```text
OUR_BRAND_LEADS=YES
ARC_IS_INFRASTRUCTURE=YES
```

A marca própria do produto deve liderar. Arc identifica a infraestrutura: pode descrever, quando tecnicamente verdadeiro, a rede sobre a qual o produto é construído, a rede suportada ou o ambiente em que a integração está disponível. Arc não deve se tornar o nome, a identidade, o ícone ou o sistema de marca do produto, nem ser usada de modo que sugira propriedade, aprovação ou endosso comercial.

## 3. Avaliação atual

A arquitetura pode ser descrita como construída sobre, disponível em ou compatível com a **Arc Network** quando essa relação for tecnicamente verdadeira e estiver atualizada no momento da publicação.

O nome público `ArcFlow` não está alinhado à regra atual porque incorpora `Arc` à identidade do produto. Por isso, `ArcFlow` fica restrito temporariamente a codinome técnico interno e não deve liderar materiais públicos novos.

Caminhos locais, nomes históricos e codinomes internos não são, por si, afirmações públicas. Sua existência pode ser preservada para estabilidade técnica e rastreabilidade histórica, mas eles não devem ser promovidos como marca externa.

Materiais revisados não devem alegar que o produto é oficial, aprovado, fabricado, patrocinado ou endossado pela Arc ou pela Circle. Também não devem alegar parceria sem documento específico e linguagem autorizada para essa relação.

```text
ARCFLOW_PUBLIC_BRAND_STATUS=NOT_ALIGNED
ARCFLOW_INTERNAL_CODENAME_STATUS=TEMPORARILY_ALLOWED
PUBLIC_MATERIALS_MUST_NOT_LEAD_WITH_ARCFLOW=YES
```

## 4. Estratégia de nome

### CriptoMorse

`CriptoMorse` é o nome inicial e legado de trabalho. Ele continua útil para descrever a fase financeira e cripto do projeto, mas se tornou estreito diante da expansão pretendida para indústria, comércio, logística, serviços e outros domínios.

### MultiMorse

`MultiMorse` é somente um candidato sugerido pelo usuário por comunicar multiplicidade e adaptação. Não foi selecionado, aprovado ou adotado; sua disponibilidade, registrabilidade e segurança jurídica não foram verificadas.

### Nome público final

O nome público final permanece em aberto.

```text
CRYPTOMORSE_STATUS=INITIAL_LEGACY_WORKING_NAME_UNDER_REVIEW
MULTIMORSE_STATUS=CANDIDATE_ONLY
FINAL_PUBLIC_NAME_STATUS=UNDECIDED
NAME_MIGRATION_AUTHORIZED=NO
```

Nenhum candidato será adotado publicamente antes de:

1. busca de marcas e avaliação de risco de confusão nas jurisdições relevantes;
2. verificação de domínio e handles;
3. busca por projetos, organizações e produtos homônimos;
4. avaliação linguística em português e inglês;
5. confirmação de que o nome não incorpora marca de terceiro;
6. aprovação humana explícita;
7. elaboração de plano separado de migração documental e técnica.

Este documento não declara que `MultiMorse` ou qualquer outro candidato esteja disponível, seja registrável, juridicamente seguro ou tenha sido escolhido.

## 5. Linguagem pública permitida

Os exemplos abaixo são recomendados somente quando tecnicamente verdadeiros:

- `[Marca própria] — built on Arc Network`;
- `[Marca própria] é construída sobre a Arc Network`;
- `[Marca própria] supports Arc`;
- `[Marca própria] está disponível na Arc`;
- usar `Arc Network` na primeira menção e `Arc` nas menções seguintes.

Enquanto o nome final não for escolhido, podem ser usadas formulações neutras:

- `o projeto, atualmente em desenvolvimento, construído sobre a Arc Network`;
- `nossa plataforma operacional, built on Arc Network`.

Essas formulações descrevem infraestrutura. Elas não conferem ou insinuam parceria, aprovação, endosso, produção ou disponibilidade em mainnet.

## 6. Linguagem pública proibida ou dependente de aprovação

Devem ser evitados:

- `ArcFlow` como marca pública;
- `The Arc App`, `Arc Payments` ou forma equivalente;
- `produto oficial da Arc`;
- `tecnologia aprovada pela Arc`;
- `parceiro da Arc/Circle`, salvo acordo assinado e linguagem aprovada;
- `robôs da Arc` quando os agentes forem do próprio projeto;
- qualquer frase que faça Arc parecer proprietária, fabricante, avalista ou patrocinadora do produto.

Para os agentes do projeto, a substituição recomendada é:

> nossos agentes integrados à Arc Network

Quando a relação precisar de contexto, o material deve descrever a relação técnica real, sem transferir ao nome ou ao logo da Arc significados que não tenham sido comprovados.

## 7. Logotipo e ativos visuais

O uso de ativos visuais da Arc é um gate futuro e específico por material:

- usar somente arquivos oficiais atuais;
- usar o logo apenas quando existir uma relação permitida pelas diretrizes vigentes;
- não modificar, recolorir, distorcer ou recriar o logo;
- não colocar texto ou gráfico sobre o logo;
- não deixar Arc mais proeminente que a marca própria;
- não incorporar o logo ao ícone ou ao sistema de marca do produto;
- obter revisão ou aprovação quando um material puder sugerir parceria, co-marketing ou endosso;
- revalidar as diretrizes antes de cada publicação relevante, pois elas podem mudar.

```text
ARC_LOGO_USAGE_APPROVED_FOR_CURRENT_PRODUCT_ASSETS=NOT_YET_VERIFIED
ARC_LOGO_MAY_NOT_BE_ADDED_WITHOUT_ASSET_LEVEL_REVIEW=YES
```

## 8. Frase temporária para apresentações

Enquanto o nome final estiver em revisão, a formulação temporária recomendada é:

**Português**

> Estamos desenvolvendo uma base operacional para agentes autônomos, construída sobre a Arc Network.

**English**

> We are building an operational foundation for autonomous agents on Arc Network.

Essas frases não devem ser usadas para alegar mainnet, produção ou parceria quando tais fatos não forem verdadeiros.

## 9. Separação entre marca e arquitetura

Uma futura mudança de nome público não altera os invariantes técnicos do sistema, incluindo ownership, fencing, authority, idempotência, settlement e auditabilidade.

Nomes internos, diretórios e caminhos serão migrados somente por um plano separado, com autorização própria, para evitar quebra de imports, documentação, automações, deployments e evidência histórica.

A identidade da infraestrutura Arc deve permanecer metadado de deployment ou integração, e não a identidade universal do núcleo camaleão e multidomínio. O núcleo operacional continua projetado para adaptação a finanças, indústria, comércio, logística e serviços sem negociar sua integridade operacional.

## 10. Gates antes de publicação

- [ ] nome público final aprovado pelo usuário;
- [ ] busca preliminar de marca e homônimos concluída;
- [ ] domínio e handles avaliados;
- [ ] linguagem `built on/supports Arc` tecnicamente verdadeira;
- [ ] nenhuma alegação de parceria ou endosso sem comprovação;
- [ ] logo oficial e uso visual revisados;
- [ ] materiais de site, UI, apresentação e redes revisados;
- [ ] diretrizes oficiais reconsultadas na data da publicação;
- [ ] consulta à Arc/Circle realizada se houver dúvida ou co-marketing.

## 11. Não escopo e autorizações

Esta alteração documental não escolhe definitivamente entre `CriptoMorse`, `MultiMorse` ou outro nome; não realiza pesquisa jurídica definitiva; não registra marca ou domínio; não cria logo; não altera UI, nomes técnicos, repositório, código, configuração, package metadata, contratos, deployment ou rede; não publica anúncio; e não contata externamente Arc ou Circle.

```text
DOCUMENTATION_CHANGE_AUTHORIZED=YES
PUBLIC_RENAME_AUTHORIZED=NO
CODE_CHANGE_AUTHORIZED=NO
STAGE_COMMIT_TAG_PUSH_DEPLOY_AUTHORIZED=NO
```

## 12. Adendo — 30 de julho de 2026: estrutura de marca em camadas e novo candidato para o núcleo universal

Este adendo registra uma discussão realizada em 30 de julho de 2026 entre
o usuário e as coordenações técnica (Claude) e criativa (ChatGPT). Não
substitui nem contradiz as seções 1 a 11 acima — os mesmos travamentos
continuam em vigor.

```text
ADDENDUM_DATE=2026-07-30
SUPERSEDES_PRIOR_SECTIONS=NO
NAME_MIGRATION_AUTHORIZED=NO
CODE_CHANGE_AUTHORIZED=NO
FINAL_PUBLIC_NAME_STATUS=UNDECIDED
```

### 12.1 Estrutura em camadas discutida

A discussão de 30/07/2026 propôs resolver a tensão já registrada na seção
4 (CriptoMorse sendo "estreito" diante da expansão multidomínio
pretendida) não esticando um único nome, mas dividindo responsabilidades
entre camadas:

```text
[nome do núcleo universal — EM ABERTO, ver 12.2]
  └── CriptoMorse — marca específica da aplicação financeira/trading
      ├── CriptoMorse Learn (educação)
      ├── CriptoMorse Lab (simulação)
      ├── CriptoMorse Testnet (observação/experimentos rotulados)
      ├── CriptoMorse Trade (operação real — última camada a liberar)
      └── Cami — mascote/guia transversal (não é marca separada)
```

Esta estrutura, se adotada, resolveria a tensão da seção 4 sem exigir que
"CriptoMorse" descreva domínios fora de finanças (indústria, comércio,
logística) — esses usariam o mesmo núcleo técnico com marca setorial
própria, ainda não nomeada.

```text
LAYERED_STRUCTURE_STATUS=DISCUSSED_NOT_ADOPTED
CRIPTOMORSE_SCOPE_NARROWED_TO_FINANCE=PROPOSED_NOT_FINAL
CAMI_ROLE=MASCOT_GUIDE_NOT_SEPARATE_BRAND_PROPOSED_NOT_FINAL
```

### 12.2 Novo candidato para o núcleo universal: VeriMorse / VeriMorse Core

Assim como `MultiMorse` (seção 4), `VeriMorse`/`VeriMorse Core` é **somente
um candidato sugerido**, desta vez ocupando o mesmo espaço em aberto que
`MultiMorse` já ocupava (nome do núcleo técnico/universal, não da marca
de trading). Não foi selecionado, aprovado ou adotado; sua
disponibilidade, registrabilidade e segurança jurídica não foram
verificadas.

Raciocínio de origem do candidato: combina "Veri" (verificação — referência
ao princípio operacional de que o sistema não celebra execução, apenas
confia em liquidação verificada) com "Morse" (a metáfora já em uso em
`CriptoMorse`), sem repetir "Cripto" (que estreitaria o núcleo universal
da mesma forma que já se buscava evitar).

Uma busca informal (não jurídica, não substitui a seção 4, itens 1-5) não
encontrou marca ou produto homônimo de destaque na data desta consulta.

```text
VERIMORSE_STATUS=CANDIDATE_ONLY
VERIMORSE_CORE_STATUS=CANDIDATE_ONLY
VERIMORSE_INFORMAL_COLLISION_CHECK=NO_OBVIOUS_COLLISION_FOUND_2026-07-30
VERIMORSE_FORMAL_CLEARANCE=NOT_PERFORMED
MULTIMORSE_STATUS=STILL_CANDIDATE_ONLY_NOT_WITHDRAWN
```

### 12.3 Gates — idênticos aos já exigidos na seção 4 para qualquer candidato

Nenhum candidato (CriptoMorse na função de núcleo universal, MultiMorse,
VeriMorse/VeriMorse Core, ou qualquer outro) será adotado publicamente
antes dos 7 itens já listados na seção 4: busca de marca e risco de
confusão, verificação de domínio/handles, busca de homônimos, avaliação
linguística PT/EN, confirmação de não incorporação de marca de terceiro,
aprovação humana explícita, e plano separado de migração documental e
técnica.

### 12.4 Não escopo deste adendo

Este adendo não escolhe definitivamente entre `CriptoMorse` (função de
núcleo universal), `MultiMorse`, `VeriMorse`/`VeriMorse Core` ou qualquer
outro nome para o núcleo técnico; não realiza pesquisa jurídica
definitiva; não registra marca, domínio ou pacote; não altera UI, nomes
técnicos, repositório, código, configuração, metadata de pacote,
contratos, deployment ou rede; não publica anúncio; e não contata
externamente Arc, Circle ou qualquer terceiro.

```text
DOCUMENTATION_CHANGE_AUTHORIZED=YES
PUBLIC_RENAME_AUTHORIZED=NO
CODE_CHANGE_AUTHORIZED=NO
STAGE_COMMIT_TAG_PUSH_DEPLOY_AUTHORIZED=NO
```
