#!/usr/bin/env bash
# Esvazia o schema public do BANCO DE TESTES em lotes (uma transação por lote), sem DROP SCHEMA CASCADE único
# (que estoura max_locks_per_transaction num banco já montado). Nunca roda na produção.
# Uso: TEST_DATABASE_URL=... scripts/banco-testes/limpar-public.sh
set -euo pipefail
: "${TEST_DATABASE_URL:?}"
case "$TEST_DATABASE_URL" in *horsymhsinqcimflrtjo*) echo "::error::destino é a PRODUÇÃO — abortado"; exit 1;; esac
P=(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -qAt)
lote() { # $1 = consulta que devolve comandos DROP, 40 por vez
  while :; do
    cmds=$("${P[@]}" -c "$1 limit 40")
    [ -n "$cmds" ] || break
    { echo "begin;"; echo "$cmds"; echo "commit;"; } | "${P[@]}" >/dev/null
  done
}
# views/materializadas, tabelas (CASCADE leva FKs/triggers/policies), rotinas, tipos, sequências — nessa ordem
lote "select format('drop materialized view if exists public.%I cascade;', c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='m'"
lote "select format('drop view if exists public.%I cascade;', c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')"
lote "select format('drop table if exists public.%I cascade;', c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')"
lote "select format('drop %s if exists public.%I(%s) cascade;', case p.prokind when 'p' then 'procedure' else 'function' end, p.proname, pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')"
lote "select format('drop type if exists public.%I cascade;', t.typname) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','d')"
lote "select format('drop sequence if exists public.%I cascade;', c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'"
"${P[@]}" -c "drop schema if exists public cascade;"
echo "schema public limpo em lotes"
