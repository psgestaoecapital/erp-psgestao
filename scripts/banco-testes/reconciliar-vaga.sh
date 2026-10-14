#!/usr/bin/env bash
# CEO 13/10 19:58 + aprovação 13/10 (restauração cirúrgica no banco de TESTES) — CONTAMINAÇÃO ENTRE PRs na vaga.
# O sync (#2519) traz o que falta da main mas NÃO remove o que sobrou de uma PR (migration não aprovada aplicada na vaga
# por execução fora do fluxo — ex.: Montar disparado num ramo de PR). Sem limpar, a próxima PR na vaga testa com código
# NÃO APROVADO. Ex. real: vaga 1 com 20261013200030 (fn_ge_listagem_v2 da PR #2515).
#
# A doutrina "nunca derrubar o banco" é da PRODUÇÃO; o banco de TESTES existe para isso e o recriar continua como rede de
# segurança. Aqui restauramos a vaga ao estado da PRODUÇÃO, cirurgicamente:
#   - DROP dos objetos que só existem na vaga (adicionados por PR, ausentes na produção);
#   - redefinição de FUNÇÕES/VIEWS modificadas a partir da definição exata da PRODUÇÃO;
#   - remoção do ledger das versions ACIMA da maior versão da main (nunca as ~800 históricas: usamos "> main_max",
#     jamais set-difference);
#   - e só COMMITA se, NO DADO, os objetos de código do public da vaga ficarem IDÊNTICOS à produção (verify-before-commit
#     dentro da MESMA transação: se não convergir, RAISE → ROLLBACK → nada muda → cai para recriar).
# Classe que não sabemos reverter com segurança (objeto modificado que não é função/view, ou objeto aprovado AUSENTE na
# vaga) → NÃO arrisca: sai com exit 2 "vaga N precisa de recriar". O recriar (Montar) é a rede de segurança.
#
# exit 0 = vaga limpa ou restaurada+verificada · exit 2 = precisa de recriar · exit 1 = erro de uso/guarda.
# Uso: TEST_DATABASE_URL=<vaga pooler, ESCRITA>  PROD_DATABASE_URL=<produção, LEITURA>  MAIN_MIGR_DIR=<dir origin/main>
#      [VAGA=N] [PSQL=psql] [WITNESS=fn_ge_listagem_v2]  reconciliar-vaga.sh
set -euo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}" "${MAIN_MIGR_DIR:?MAIN_MIGR_DIR ausente}"
# PROD_DATABASE_URL é OPCIONAL:
#  - AUSENTE (modo DETECÇÃO, usado na aceitação, que por Pilar 2 não carrega segredo de produção): só detecta e, se
#    contaminada, falha com exit 2 "precisa de recriar" — barra banco sujo sem nunca ler a produção.
#  - PRESENTE (modo RESTAURAÇÃO, usado no workflow reconciliar-vaga.yml, que tem credencial de produção como o montar):
#    restaura a vaga ao estado da produção (cirúrgico + verify-before-commit).
PROD_DATABASE_URL="${PROD_DATABASE_URL:-}"
PSQL="${PSQL:-psql}"
VAGA="${VAGA:-?}"
WITNESS="${WITNESS:-fn_ge_listagem_v2}"
PROD_REF=horsymhsinqcimflrtjo
export LC_ALL=C
erro()    { echo "::error::$*"; exit 1; }
recriar() { echo "::error::vaga ${VAGA} precisa de recriar: $*"; exit 2; }
resumo()  { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY" || true; echo "$*"; }

# Travas: nunca escreve na produção; destino é Session pooler de teste; origem (quando houver) é a produção.
case "$TEST_DATABASE_URL" in *"$PROD_REF"*) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado";; esac
case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) erro "vaga ${VAGA}: TEST_DATABASE_URL precisa ser Session pooler";; esac
[ -z "$PROD_DATABASE_URL" ] || case "$PROD_DATABASE_URL" in *"$PROD_REF"*) ;; *) erro "PROD_DATABASE_URL não é a produção";; esac

main_max=$(ls "$MAIN_MIGR_DIR"/*.sql 2>/dev/null | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | tail -1)
[ -n "$main_max" ] || erro "não achei migrations em MAIN_MIGR_DIR ($MAIN_MIGR_DIR)"

mapfile -t extras < <("$PSQL" "$TEST_DATABASE_URL" -tAc "select version from supabase_migrations.schema_migrations where version > '$main_max' order by version")
if [ "${#extras[@]}" -eq 0 ]; then
  echo "vaga ${VAGA}: ledger em dia com a main (nenhuma versão > $main_max) — nada a reconciliar."
  exit 0
fi
echo "::warning::vaga ${VAGA} contaminada — versões além da main ($main_max): ${extras[*]}"
# Modo DETECÇÃO (sem produção): não restaura, só barra o banco sujo.
if [ -z "$PROD_DATABASE_URL" ]; then
  recriar "ledger com ${#extras[@]} versão(ões) de PR não aprovada além da main (${extras[*]}). Rode o workflow reconciliar-vaga (restauração cirúrgica) ou o Montar (recriar)."
fi

# ── Assinatura ABRANGENTE dos objetos de código/estrutura do public (chave|hash). "Assinaturas iguais ⇒ esquema igual"
# no que importa: função, view, tabela, coluna(tipo/nulo/default), índice, constraint, trigger, policy, RLS, grants,
# type/enum, sequence. É o que a verificação final compara dentro da transação. ──────────────────────────────────────
SIG="
select ('func '||p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid)))::text as sig from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p','w')
union all select 'view '||c.relname||'|'||md5(pg_get_viewdef(c.oid)) from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')
union all select 'table '||c.relname||'|' from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all select 'col '||table_name||'.'||column_name||'|'||udt_name||coalesce(':'||character_maximum_length::text,'')||'/'||is_nullable||'/'||md5(coalesce(column_default,''))
  from information_schema.columns where table_schema='public'
union all select 'index '||c.relname||'|'||md5(pg_get_indexdef(c.oid)) from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='i'
union all select 'constraint '||con.conname||' on '||rel.relname||'|'||md5(pg_get_constraintdef(con.oid)) from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public'
union all select 'trigger '||t.tgname||' on '||c.relname||'|'||md5(pg_get_triggerdef(t.oid)) from pg_trigger t
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all select 'policy '||pol.polname||' on '||c.relname||'|'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'/'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')||'/'||pol.polcmd||'/'||array_to_string(coalesce(pol.polroles,'{}'),','))
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
union all select 'rls '||c.relname||'|'||c.relrowsecurity::text||c.relforcerowsecurity::text from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all select 'grant-rel '||c.relname||'|'||md5(coalesce(array_to_string(c.relacl,','),'')) from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S')
union all select 'grant-fn '||p.oid::regprocedure::text||'|'||md5(coalesce(array_to_string(p.proacl,','),'')) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p','w')
union all select 'type '||t.typname||'|'||t.typtype||'/'||coalesce((select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'')
  from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','c','d')
union all select 'sequence '||c.relname||'|' from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'"
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
"$PSQL" "$PROD_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; $SIG" | sort > "$dir/prod.sig"
"$PSQL" "$TEST_DATABASE_URL"  -tA -v ON_ERROR_STOP=1 -c "$SIG" | sort > "$dir/vaga.sig"
[ -s "$dir/prod.sig" ] || erro "assinatura da produção vazia (leitura falhou)"

cut -d'|' -f1 "$dir/prod.sig" | sort -u > "$dir/prod.keys"
cut -d'|' -f1 "$dir/vaga.sig" | sort -u > "$dir/vaga.keys"
comm -13 "$dir/prod.keys" "$dir/vaga.keys" > "$dir/vaga_only.keys"   # na vaga e não na prod → objeto da PR (DROP)
comm -23 "$dir/prod.keys" "$dir/vaga.keys" > "$dir/prod_only.keys"   # na prod e não na vaga → vaga perdeu objeto aprovado
comm -3 "$dir/prod.sig" "$dir/vaga.sig" | sed 's/^[[:space:]]*//' | cut -d'|' -f1 | sort -u > "$dir/changed.all"
comm -12 "$dir/changed.all" "$dir/prod.keys" | comm -12 - "$dir/vaga.keys" > "$dir/diff.keys"  # em ambos, diferente

# Irreversível com segurança → recriar (antes de tocar em nada):
if [ -s "$dir/prod_only.keys" ]; then
  echo "objetos aprovados AUSENTES na vaga:"; sed 's/^/  - /' "$dir/prod_only.keys" | head
  recriar "a vaga perdeu objeto(s) aprovado(s) (PR fez DROP/rename) — restauração parcial seria insegura"
fi
if grep -qvE '^(func|view) ' "$dir/diff.keys" 2>/dev/null; then
  echo "objetos MODIFICADOS de classe não restaurável (só restauramos função/view):"; grep -vE '^(func|view) ' "$dir/diff.keys" | sed 's/^/  - /' | head
  recriar "objeto modificado que não é função/view"
fi

# tabelas que serão derrubadas (os filhos delas somem no CASCADE — não emitir drop de filho de tabela-nova)
{ grep '^table ' "$dir/vaga_only.keys" || true; } | sed 's/^table //' | sort -u > "$dir/tdrop.names"
pertence_a_tabela_nova() { local tbl="$1"; grep -qxF "$tbl" "$dir/tdrop.names"; }

txn="$dir/restore.sql"
{
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  echo "set local statement_timeout='180s'; set local lock_timeout='20s';"
} > "$txn"
# 1) DROP dos objetos vaga-only
nd=0
while IFS= read -r k; do
  [ -z "$k" ] && continue; nd=$((nd+1))
  case "$k" in
    "func "*)     echo "drop function if exists ${k#func } cascade;" >> "$txn";;
    "view "*)     echo "drop view if exists public.\"${k#view }\" cascade;" >> "$txn";;
    "table "*)    echo "drop table if exists public.\"${k#table }\" cascade;" >> "$txn";;
    "type "*)     echo "drop type if exists public.\"${k#type }\" cascade;" >> "$txn";;
    "sequence "*) echo "drop sequence if exists public.\"${k#sequence }\" cascade;" >> "$txn";;
    "col "*)      tc=${k#col }; t=${tc%%.*}; c=${tc#*.}; pertence_a_tabela_nova "$t" || echo "alter table if exists public.\"$t\" drop column if exists \"$c\" cascade;" >> "$txn";;
    "index "*)    echo "drop index if exists public.\"${k#index }\" cascade;" >> "$txn";;
    "constraint "*) cn=${k#constraint }; con=${cn% on *}; tbl=${cn#* on }; pertence_a_tabela_nova "$tbl" || echo "alter table if exists public.\"$tbl\" drop constraint if exists \"$con\";" >> "$txn";;
    "trigger "*)  tn=${k#trigger }; tg=${tn% on *}; tbl=${tn#* on }; pertence_a_tabela_nova "$tbl" || echo "drop trigger if exists \"$tg\" on public.\"$tbl\";" >> "$txn";;
    "policy "*)   pn=${k#policy }; pl=${pn% on *}; tbl=${pn#* on }; pertence_a_tabela_nova "$tbl" || echo "drop policy if exists \"$pl\" on public.\"$tbl\";" >> "$txn";;
    "rls "*)      ;;  # rls só aparece vaga-only se a tabela for nova → some no CASCADE
    "grant-"*)    ;;  # grant de objeto novo some com o objeto; grant de objeto existente é diff (tratado abaixo? não: cai no verify)
    *) recriar "classe vaga-only não tratável: $k";;
  esac
done < "$dir/vaga_only.keys"
# 2) FUNÇÕES/VIEWS modificadas → redefine a partir da PRODUÇÃO (DDL exata do catálogo)
nr=0
while IFS= read -r k; do
  [ -z "$k" ] && continue; nr=$((nr+1))
  case "$k" in
    "func "*) sig=${k#func }
      ddl=$("$PSQL" "$PROD_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select pg_get_functiondef('$sig'::regprocedure)")
      printf '%s;\n' "$ddl" >> "$txn";;
    "view "*) vn=${k#view }
      def=$("$PSQL" "$PROD_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select pg_get_viewdef('public.\"$vn\"'::regclass, true)")
      printf 'create or replace view public."%s" as %s;\n' "$vn" "$def" >> "$txn";;
  esac
done < "$dir/diff.keys"
# 3) Ledger: remove só as versions acima da main
echo "delete from supabase_migrations.schema_migrations where version > '$main_max';" >> "$txn"
# 4) VERIFY-BEFORE-COMMIT: a assinatura viva da vaga tem de ficar IGUAL à da produção; senão RAISE → ROLLBACK.
cp "$dir/prod.sig" "$dir/prod.sig.copy"
{
  echo "create temp table _prodsig(sig text) on commit drop;"
  echo "\\copy _prodsig(sig) from '$dir/prod.sig.copy'"
  echo "create temp table _vagasig on commit drop as $SIG;"
  echo "do \$v\$ declare d bigint; begin"
  echo "  select count(*) into d from ((select sig from _prodsig except select sig from _vagasig) union all (select sig from _vagasig except select sig from _prodsig)) x;"
  echo "  if d <> 0 then raise exception 'reconcilia: vaga nao convergiu para a producao (% diferenca(s) de assinatura)', d; end if;"
  echo "end \$v\$;"
  echo "do \$l\$ declare n bigint; begin"
  echo "  select count(*) into n from supabase_migrations.schema_migrations where version > '$main_max';"
  echo "  if n <> 0 then raise exception 'reconcilia: ainda ha % versao(es) alem da main no ledger', n; end if;"
  echo "end \$l\$;"
  echo "commit;"
} >> "$txn"

# Testemunha (RD-38): hash da definição de \$WITNESS na vaga ANTES e na produção.
w_vaga_antes=$({ grep -E "^func public\.${WITNESS}\(" "$dir/vaga.sig" || true; } | head -1 | cut -d'|' -f2)
w_prod=$({ grep -E "^func public\.${WITNESS}\(" "$dir/prod.sig" || true; } | head -1 | cut -d'|' -f2)
led_antes="${#extras[@]} versão(ões) além da main (${extras[*]})"

echo "restaurando a vaga ${VAGA}: $nd objeto(s) vaga-only a derrubar, $nr função/view a redefinir da produção…"
if ! "$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$txn"; then
  recriar "a restauração não convergiu (RAISE/erro → ROLLBACK; a vaga ficou intacta e contaminada)"
fi

# Pós-commit: reconfere no dado e monta a prova.
w_vaga_depois=$("$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${WITNESS}' limit 1" || true)
led_depois=$("$PSQL" "$TEST_DATABASE_URL" -tAc "select count(*) from supabase_migrations.schema_migrations where version > '$main_max'")
resumo "### Restauração cirúrgica da vaga ${VAGA} → produção"
resumo ""
resumo "| item | antes | depois | produção |"
resumo "| --- | --- | --- | --- |"
resumo "| ledger (versões > main $main_max) | $led_antes | $led_depois | 0 |"
resumo "| md5 pg_get_functiondef(${WITNESS}) | ${w_vaga_antes:-ausente} | ${w_vaga_depois:-ausente} | ${w_prod:-ausente} |"
resumo "| objetos derrubados / funções-views redefinidas | — | $nd / $nr | — |"
echo "vaga ${VAGA}: restaurada e VERIFICADA (objetos de código do public == produção; ledger sem versão > $main_max)."
exit 0
