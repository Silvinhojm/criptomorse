<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:arcflow-rules -->
# ARCFLOW — Regras para IAs

1. **LEIA `ARCFLOW.md` PRIMEIRO** — contém o mapa completo do sistema, parâmetros, arquitetura e fluxos. Não modifique código sem consultá-lo.

2. **Mantenha a documentação atualizada** — toda alteração em parâmetros, novos módulos, mudanças de fluxo ou adição de tokens deve refletir em `ARCFLOW.md`. Se a IA não fizer isso automaticamente, o desenvolvedor vai pedir.

3. **Nunca duplique COIN_IDS** — ao adicionar um token, atualize em TODOS os 5 lugares (listados na seção 14 do ARCFLOW.md).

4. **Persistência primeiro** — qualquer estado que deve sobreviver a F5 precisa de localStorage com chave `arcflow_*`. Documente no ARCFLOW.md seção 5.

5. **Staircase sempre vende pra USDC** — o fechamento automático sempre gera ordem vendendo o token volátil → USDC, independente de como foi comprado.
<!-- END:arcflow-rules -->

- Ao verificar estado do sistema, commit altera��es no ARCFLOW.md e no c�digo e fa�a push
