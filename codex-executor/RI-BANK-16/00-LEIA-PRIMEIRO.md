# RI-BANK-16 — pacote de proposta técnica

Comece por [RI-BANK-16-TECHNICAL-PROPOSAL-CODEX.md](RI-BANK-16-TECHNICAL-PROPOSAL-CODEX.md).

O documento apresenta pelo menos duas opções reais para cada item:

- P1: variável sensível Vercel, secret manager exportável e KMS/HSM não exportável;
- P2: plano Redis, body do workflow, scanner direto e modelo híbrido;
- P3: lock simples, lease + máquina de estados e Redis Stream.

Recomendações não vinculantes: KMS + OIDC, plano unitário no Redis e lease + idempotência por `planId` via Lua.

Escopo observado: proposta somente; nenhum código alterado e nenhuma execução realizada.

