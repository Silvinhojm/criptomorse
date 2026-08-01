# RI-BANK-13 — pacote de entrega do Codex

Comece por `RI-BANK-13-EXECUTION-REPORT-CODEX.md`.

O pacote contém o relatório, o mandato original, o teste RI-BANK-12 integral que faltava, as duas provas RI-BANK-13 e snapshots dos módulos alterados.

Resultado principal: a corrida cross-instance foi eliminada no código por incrementos Redis atômicos e por um script Lua transacional. A prova contra Redis externo ficou preparada, mas não foi executada porque o cabeçalho do mandato restringe execução a memória/mock; a tentativa de autorização foi recusada por essa razão.

