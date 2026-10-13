# Reconciliação do histórico de migrations — 2026-08-13

## Problema
`supabase db push` falhava com *"Remote migration versions not found in local migrations directory"*:
o tracker `supabase_migrations.schema_migrations` tinha **692** versões, das quais **540 órfãs**
(carimbadas pela conta MCP, sem arquivo `.sql` no repo) → o `db push` se recusava a rodar, travando
**todo** deploy de migration (inclusive o import dos 1.384 produtos Tryo).

## O que foi feito (não-destrutivo — só o tracker; schema intocado)
Backup: `bkp.schema_migrations_20260813` (692 linhas).
- **INSERT** de 361 versões repo-only (arquivos no repo cujo schema já estava aplicado sob outra versão)
  como aplicadas (`ON CONFLICT DO NOTHING`).
- **DELETE** das 540 órfãs (tracker sem arquivo no repo).
- Deixados **pendentes** só os 2 genuinamente novos: `20260813240000_import_estoque_tryo` e
  `20260813250000_produtos_legais` (aplicam no próximo `db push`, em ordem).

Resultado: tracker = arquivos do repo, exceto os 2 pendentes. Schema **inalterado** (funções/tabelas iguais
antes e depois — auditado via MCP).

## Prevenir recorrência
Mudança de schema de domínio deve entrar como **arquivo de migration** (aplicada pelo CI `deploy-migrations`),
não via MCP ad-hoc. Auditorias/RPCs via MCP idealmente também viram arquivo. Se o MCP for usado, rodar esta
reconciliação periodicamente (reconstruir/re-keyar do tracker) para o `db push` voltar a ser no-op nas antigas.
