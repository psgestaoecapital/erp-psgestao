#!/usr/bin/env bash
# INFRA-TESTES Slice 1 (contexto f076af2d) — smoke do banco montado SÓ com migrations+semente (sem dump da produção).
# Roda no portao-semente-pr.yml contra um Postgres local descartável. Nunca aceita produção como destino.
set -euo pipefail
: "${SMOKE_DATABASE_URL:?SMOKE_DATABASE_URL ausente}"
case "$SMOKE_DATABASE_URL" in *supabase.co*|*pooler.supabase.com*|*horsymhsinqcimflrtjo*) echo "::error::smoke recusa banco remoto/produção"; exit 1;; esac
Q() { psql "$SMOKE_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$1"; }
falhou=0
exige() { # exige "<descrição>" "<sql que devolve t/f>"
  local r; r=$(Q "$2" 2>&1 | tail -n1 || true)
  if [ "$r" = "t" ]; then echo "ok   - $1"; else echo "::error title=smoke::$1 (resultado: ${r:0:200})"; falhou=1; fi
}
repo_max=$(ls supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | tail -1)
exige "ledger == última migration do repo ($repo_max)" "select coalesce(max(version),'')='$repo_max' from supabase_migrations.schema_migrations"
exige "fn_demo_reset existe" "select to_regproc('public.fn_demo_reset') is not null"
exige "fn_briefing_sessao existe" "select to_regproc('public.fn_briefing_sessao') is not null"
exige "fn_agente_caixa existe" "select to_regproc('public.fn_agente_caixa') is not null"
exige "tabelas públicas com RLS ligada existem" "select count(*)>0 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity"
# fn_demo_reset por empresa DEMO: só roda se a empresa existe na semente; erro real da função reprova a PR.
for emp in b0700000-0000-4000-a000-000000000001 b0700000-0000-4000-a000-000000000002 b0700000-0000-4000-a000-000000000003 b0700000-0000-4000-a000-000000000004 b0700000-0000-4000-a000-000000000005 ded00000-0000-4000-a000-000000000001; do
  existe=$(Q "select exists(select 1 from public.empresas where id='$emp')" 2>/dev/null || echo f)
  if [ "$existe" != "t" ]; then echo "::notice::DEMO $emp ausente da semente local — fn_demo_reset não exercitado"; continue; fi
  if Q "select public.fn_demo_reset('$emp')" >/dev/null 2>smoke-reset.err; then echo "ok   - fn_demo_reset($emp)"; else echo "::error title=smoke::fn_demo_reset($emp) falhou: $(tr '\n' ' ' < smoke-reset.err | cut -c1-600)"; falhou=1; fi
done
[ "$falhou" = 0 ] || { echo "::error::portão de semente reprovou — a PR dessincroniza migrations/semente"; exit 1; }
echo "### Portão de semente: migrations aplicadas do zero + smoke ✓ (ledger=$repo_max)" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
