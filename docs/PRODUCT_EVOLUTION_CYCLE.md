# Ciclo de Evolução Controlada do ArcFlow

A planta original orienta a construção, mas o terreno também ensina.

Conforme a obra avança, descobrimos obstáculos que não estavam visíveis, partes que perderam utilidade, necessidades novas, caminhos mais seguros, elementos que precisam mudar de lugar e espaços que devem ser reconstruídos para comportar uma visão maior.

Isso não significa trabalhar sem planejamento. Significa praticar uma evolução controlada, documentada e auditável.

## Ciclo

```
Construir → Observar → Analisar → Classificar → Retirar → Reconstruir → Validar → Concluir
```

Após a conclusão, o ciclo recomeça sobre uma base melhor.

### 1. Construir

Implementamos uma solução com base no conhecimento disponível naquele momento.

### 2. Observar

Verificamos como ela se comporta no código, na interface e na experiência real do usuário.

### 3. Analisar

Perguntamos:

- Ainda atende ao propósito atual?
- Pertence ao núcleo ou a um uso antigo?
- Causa poluição visual?
- Cria conflito de autoridade?
- Induz o usuário a entender o produto de forma errada?
- Deveria estar em uma área técnica?

### 4. Classificar

Cada elemento recebe uma decisão:

| Decisão | Significado |
|---------|-------------|
| Manter | Permanece como está |
| Mover | Transferir para outra área |
| Ocultar | Remover da navegação pública, manter no código |
| Redesenhar | Reformular sem mudar propósito |
| Substituir | Trocar por abordagem diferente |
| Depreciar | Marcar como legado, remover em ciclo futuro |
| Remover | Eliminar completamente |

### 5. Retirar

O que não serve mais é removido de forma controlada, verificando dependências e possíveis regressões.

### 6. Reconstruir

Reorganizamos o espaço para refletir a nova visão do projeto.

### 7. Validar

Executamos testes técnicos, revisão visual, navegação e auditoria de escopo.

### 8. Concluir

Somente após evidência suficiente fazemos o checkpoint.

## Princípios

- **A planta orienta a construção, mas o terreno também ensina.** — O plano inicial é referência, não prisão.

- **ArcFlow não mantém uma funcionalidade apenas porque ela já foi construída.** — Ela permanece quando continua servindo ao propósito do produto.

- **Retirar não significa fracassar.** — Retirar pode ser parte necessária da evolução arquitetural.

- **Nenhuma reconstrução deve apagar a cadeia de custódia da decisão anterior.** — Toda mudança tem registro, justificativa e checkpoint.

- **Mudanças de produto, interface e posicionamento devem possuir escopo, justificativa, testes e checkpoint próprios.**

## Fases futuras de limpeza do produto

Estas fases são candidatas a ciclos futuros, não um cronograma:

| Fase | Descrição |
|------|-----------|
| Product Surface Audit | Inventário de páginas, menus e componentes |
| Product Classification | Núcleo, financeiro, testnet, desenvolvimento, histórico |
| Navigation Cleanup | Retirar ou mover itens que confundem o usuário |
| Product Reframing | Ajustar textos e identidade para framework universal |
| Interface Reconstruction | Reorganizar áreas, jornadas e hierarquia visual |
| UX and Architecture Validation | Testar clareza, segurança e ausência de regressões |
| Product Cleanup Checkpoint | Concluir e registrar a nova superfície |

## Aplicação: caso dos faucets

1. **Construída**: porque o projeto dependia fortemente da testnet.
2. **Observada**: agora aparece na navegação de um framework que pretende ser universal.
3. **Analisada**: pode confundir usuários e reforçar uma identidade antiga de bot/testnet.
4. **Decisão preliminar**: retirar da navegação pública.
5. **Reconstrução**: mover para área de desenvolvedor ou documentação técnica.
6. **Validação**: confirmar que nenhum fluxo necessário foi quebrado.
7. **Conclusão**: checkpoint próprio de limpeza da interface.
