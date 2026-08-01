# RI-BANK-13 — Relatório da autorização Redis escopada

Data: 31/07/2026  
Status: **NÃO EXECUTADO — condição de ambiente não satisfeita**

## Confirmação prévia obrigatória

- `KV_REST_API_URL` está configurada para o host `ace-labrador-88457.upstash.io`.
- `VERCEL_ENV` está ausente no `.env.local`.
- `lib/kv.ts`, linhas 33–35, documenta que esse recurso Upstash está conectado a `production`, `preview` e `development`, que compartilham **o mesmo banco físico**.

Consequentemente, não é possível confirmar honestamente que as credenciais atuais apontam para um Redis exclusivamente teste/dev. Executar contra esse endpoint violaria a condição expressa “nunca produção”, mesmo usando namespace local isolado.

## Execução e chaves

- `lib/security/ri-bank-13-cross-instance-redis.test.ts`: **não executado**.
- Outros testes/scripts/trades/wallets: **não executados**.
- Chaves `arcflow:ri-bank-13:test:*` criadas: **nenhuma**.
- Limpeza Redis: não aplicável; nenhuma chave foi criada.
- Alterações de código: **nenhuma**.

O teste atual é idêntico ao entregue anteriormente. SHA-256 verificado nas três cópias (arquivo do repositório, pacote `codex-executor` anterior e pacote no Desktop):

```text
EDDE95A81766060E11613AA806AFF16396348F09EF368C3EB4B407D8950E786C
```

## Como desbloquear

Fornecer credenciais `KV_REST_API_URL`/`KV_REST_API_TOKEN` de uma base Upstash dedicada exclusivamente a teste/dev, ou emitir nova autorização que permita explicitamente o banco físico compartilhado atual usando apenas o namespace efêmero do teste.

## Anexos

- `ANEXO-COMPLETO-lib-corretor.ts`
- `ANEXO-COMPLETO-trading-adapter.ts`
- `ANEXO-TESTE-NAO-MODIFICADO-ri-bank-13-cross-instance-redis.test.ts`

