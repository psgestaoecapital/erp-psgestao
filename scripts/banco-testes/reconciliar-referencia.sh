#!/usr/bin/env bash
# CEO 18/10 (ETAPA B) — RECONCILIAÇÃO NO INÍCIO de toda aceitação de PR, ANTES de aplicar a migration da PR, comparando a
# vaga da PR (0 ou 2) com o BANCO DE REFERÊNCIA (vaga 1, SÓ LEITURA). É a garantia da vaga limpa; o "Desfazer" do fim da
# aceitação continua, mas não é mais o que garante a limpeza.
#
# Por que a referência é a vaga 1 e não a produção: a vaga 1 é o banco da aceitação da main, mantido no estado da main
# (montar/reconciliar da vaga 1). Compará-la NÃO carrega segredo de produção (Pilar 2) — é outro banco de TESTES, lido
# só por SELECT. O chamador (aceitacao-pr.yml) já sincroniza a vaga com a main (db push idempotente) ANTES desta
# reconciliação, então "vaga atrás da main" não existe aqui: qualquer objeto da referência ausente na vaga é diferença
# ESTRUTURAL de verdade.
#
# Decisão (comparando a vaga ALVO com a REFERÊNCIA):
#   (a) LEDGER: versões que a vaga tem e a referência NÃO (e que NÃO pertencem a uma migration da main) → remove do
#       ledger da vaga (depois de remover os objetos);
#   (b) objetos do schema public na vaga e NÃO na referência (função, view, tabela, tipo, trigger, policy, índice,
#       constraint, coluna, sequence) → DROP na vaga, SEM CASCADE, em ordem de dependência;
#   (c) FUNÇÕES em ambos com DEFINIÇÃO e/ou PERMISSÕES diferentes → recria na vaga a partir da referência
#       (pg_get_functiondef + REVOKE/GRANT da referência); VIEW diferente → create or replace; grant-fn diferente →
#       reaplica as permissões da referência;
#   (d) qualquer diff NÃO corrigível com segurança (objeto da referência AUSENTE na vaga, modificado que não é
#       função/view/permissão-de-função, OU um DROP que falha por dependência sem CASCADE) → NÃO corrige: exit 2
#       "precisa de Montar". O chamador dispara o Montar da vaga e marca a PR para re-rodar.
#
# Revisão do Eng. Chefe (18/10) — QUATRO proteções obrigatórias (a mudança APAGA objetos no banco):
#   P1 REFERÊNCIA ATRASADA: só reconcilia se o ledger da referência contém TODAS as migrations da main (e a versão máxima
#      da referência == a última migration da main). Referência atrás (ou à frente) da main → PULA (exit 0), comportamento
#      atual segue. NUNCA remove da vaga objeto/versão que pertença a uma migration presente na main.
#   P2 LEITURA CONSISTENTE: lê o ledger da referência ANTES e DEPOIS de coletar o catálogo; se mudou (a aceitação da main
#      rodou no meio), descarta a comparação e PULA (exit 0).
#   P3 EXTENSÕES: exclui da comparação E de qualquer DROP todo objeto que dependa de extensão (pg_depend deptype='e') e os
#      objetos de sistema do Supabase (cobertos por serem de extensão: pg_graphql, pgjwt, etc.).
#   P4 SEM CASCADE: nenhum DROP ... CASCADE. DROP que falha por dependência → diferença estrutural (caso d) → Montar.
#
# VERIFY-BEFORE-COMMIT na transação + verificação final no dado (RD-38): nunca termina 0 se, no dado, a vaga ≠ referência.
#
# exit 0 = vaga reconciliada e VERIFICADA igual à referência (ou pulada/nada a fazer) · exit 2 = precisa de Montar · exit 1 = erro/guarda.
# Uso: VAGA=0|2  TEST_DATABASE_URL=<vaga alvo, pooler, ESCRITA>  REF_DATABASE_URL=<vaga 1, pooler, SÓ LEITURA>
#      MAIN_MIGR_DIR=<dir origin/main>  [PSQL=psql]  [WITNESS=fn_ge_listagem_v2]  reconciliar-referencia.sh
set -uo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}" "${REF_DATABASE_URL:?REF_DATABASE_URL ausente}" "${MAIN_MIGR_DIR:?MAIN_MIGR_DIR ausente}"
PSQL="${PSQL:-psql}"
VAGA="${VAGA:-?}"
WITNESS="${WITNESS:-fn_ge_listagem_v2}"
PROD_REF=horsymhsinqcimflrtjo          # id da PRODUÇÃO — proibido em qualquer URL
REF_ALVO=mgyxiamybepkphtfhway          # id da REFERÊNCIA (vaga 1) — único permitido como referência
VAGA0_REF=xjzqndnvjkdjyisuklpy         # id da vaga 0 (alvo permitido)
VAGA2_REF=jvntcgqoeuckljzeojxp         # id da vaga 2 (alvo permitido)
export LC_ALL=C
erro()    { echo "::error::$*"; exit 1; }
montar()  { echo "::error::vaga ${VAGA} precisa de Montar: $*"; exit 2; }
pular()   { echo "::notice::vaga ${VAGA}: $* — reconciliação com a referência pulada (segue o comportamento atual)."; exit 0; }
resumo()  { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY" || true; echo "$*"; }

# ── TRAVAS OBRIGATÓRIAS (segurança — o script APAGA objetos no banco) ────────────────────────────────────────────────
# 1) PRODUÇÃO em QUALQUER URL (alvo ou referência) → aborta.
case "$TEST_DATABASE_URL" in *"$PROD_REF"*) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO ($PROD_REF) — abortado";; esac
case "$REF_DATABASE_URL"  in *"$PROD_REF"*) erro "REF_DATABASE_URL aponta para a PRODUÇÃO ($PROD_REF) — abortado";; esac
# 2) ALVO só pode ser a vaga 0 ou a 2 (allowlist positivo pelos ids). Fecha "alvo = referência" e "alvo = produção".
case "$TEST_DATABASE_URL" in
  *"$VAGA0_REF"*|*"$VAGA2_REF"*) ;;
  *) erro "TEST_DATABASE_URL não é a vaga 0 ($VAGA0_REF) nem a vaga 2 ($VAGA2_REF) — a reconciliação só escreve nessas vagas";;
esac
# 3) REFERÊNCIA só pode ser a vaga 1 (mgyxiamybepkphtfhway).
case "$REF_DATABASE_URL" in
  *"$REF_ALVO"*) ;;
  *) erro "REF_DATABASE_URL não é a referência (vaga 1, $REF_ALVO) — abortado";;
esac
# 4) Session pooler nos dois (alvo e referência).
case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) erro "vaga ${VAGA}: TEST_DATABASE_URL precisa ser Session pooler";; esac
case "$REF_DATABASE_URL"  in *pooler.supabase.com*) ;; *) erro "referência: REF_DATABASE_URL precisa ser Session pooler";; esac

main_max=$(ls "$MAIN_MIGR_DIR"/*.sql 2>/dev/null | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | tail -1)
[ -n "$main_max" ] || erro "não achei migrations em MAIN_MIGR_DIR ($MAIN_MIGR_DIR)"

# ── Assinatura ABRANGENTE dos objetos de código/estrutura do public (chave|hash), EXCLUINDO objetos de extensão (P3:
#    pg_depend deptype='e' — cobre também os objetos de sistema do Supabase, que são de extensão). É o que a verificação
#    final compara. ─────────────────────────────────────────────────────────────────────────────────────────────────
# NÃO_EXT(<oid>) = o objeto não pertence a nenhuma extensão.
SIG="
select ('func '||p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid)))::text as sig from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p','w')
    and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all select 'view '||c.relname||'|'||md5(pg_get_viewdef(c.oid)) from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
union all select 'table '||c.relname||'|' from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
union all select 'col '||ic.table_name||'.'||ic.column_name||'|'||ic.udt_name||coalesce(':'||ic.character_maximum_length::text,'')||'/'||ic.is_nullable||'/'||md5(coalesce(ic.column_default,''))
  from information_schema.columns ic where ic.table_schema='public'
    and not exists (select 1 from pg_depend d join pg_class c2 on c2.oid=d.objid join pg_namespace n2 on n2.oid=c2.relnamespace where n2.nspname='public' and c2.relname=ic.table_name and d.deptype='e')
union all select 'index '||c.relname||'|'||md5(pg_get_indexdef(c.oid)) from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='i'
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
union all select 'constraint '||con.conname||' on '||rel.relname||'|'||md5(pg_get_constraintdef(con.oid)) from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public'
    and not exists (select 1 from pg_depend d where d.objid=con.oid and d.deptype='e')
    and not exists (select 1 from pg_depend d where d.objid=rel.oid and d.deptype='e')
union all select 'trigger '||t.tgname||' on '||c.relname||'|'||md5(pg_get_triggerdef(t.oid)) from pg_trigger t
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
union all select 'policy '||pol.polname||' on '||c.relname||'|'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'/'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')||'/'||pol.polcmd::text||'/'||array_to_string(coalesce(pol.polroles,'{}'),','))
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
union all select 'rls '||c.relname||'|'||c.relrowsecurity::text||c.relforcerowsecurity::text from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
union all select 'grant-rel '||c.relname||'|'||md5(coalesce(array_to_string(c.relacl,','),'')) from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S')
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
union all select 'grant-fn '||p.oid::regprocedure::text||'|'||md5(coalesce(array_to_string(p.proacl,','),'')) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p','w')
    and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all select 'type '||t.typname||'|'||t.typtype::text||'/'||coalesce((select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'')
  from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','c','d')
    and not exists (select 1 from pg_depend d where d.objid=t.oid and d.deptype='e')
union all select 'sequence '||c.relname||'|' from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')"

set -e
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT

# ── P2 (leitura consistente, 1ª leitura): ledger da referência ANTES de coletar o catálogo. ──────────────────────────
"$PSQL" "$REF_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; select version from supabase_migrations.schema_migrations order by 1" | sort > "$dir/ref.led.antes"
[ -s "$dir/ref.led.antes" ] || erro "ledger da referência vazio (leitura falhou)"

# A REFERÊNCIA é lida SÓ por SELECT (nunca -f, nunca DDL/DML), com timeout curto. A vaga é a única que recebe escrita.
"$PSQL" "$REF_DATABASE_URL"  -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; $SIG" | sort > "$dir/ref.sig"
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "$SIG" | sort > "$dir/vaga.sig"
[ -s "$dir/ref.sig" ] || erro "assinatura da referência vazia (leitura falhou)"

# ── P2 (2ª leitura): ledger da referência DEPOIS do catálogo. Mudou no meio (aceitação da main rodou) → descarta e pula. ─
"$PSQL" "$REF_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; select version from supabase_migrations.schema_migrations order by 1" | sort > "$dir/ref.led.depois"
if ! cmp -s "$dir/ref.led.antes" "$dir/ref.led.depois"; then
  pular "o ledger da referência mudou durante a leitura (a aceitação da main rodou no meio)"
fi
cp "$dir/ref.led.antes" "$dir/ref.led"

# ── P1 (referência atrasada): a referência precisa conter TODAS as migrations da main e ter a MESMA versão máxima. ────
ls "$MAIN_MIGR_DIR"/*.sql 2>/dev/null | sed -E 's#.*/([0-9]+)_.*#\1#' | sort -u > "$dir/main.led"
ref_max=$(tail -1 "$dir/ref.led")
faltando=$(comm -23 "$dir/main.led" "$dir/ref.led" | grep -c . || true)   # migrations da main AUSENTES no ledger da referência
if [ "$faltando" -ne 0 ]; then
  echo "::warning::referência (vaga 1) com ${faltando} migration(ões) da main ausente(s) no ledger (ref_max=${ref_max}, main_max=${main_max})"
  # 22/10 (gilberto-desenv): ANTES era "pular" em silêncio → vaga sem reconciliar → aceitação FLAKY por sobra de PR. Agora o
  # workflow sincroniza a referência com a main antes; se ainda assim não bate, FALHA explícito (nunca testa em banco sem checar).
  erro "referência (vaga 1) atrás da main (${faltando} migration(ões) ausente(s)) mesmo após a sincronização — aceitação abortada; rode o Montar da vaga 1"
fi
if [ "$ref_max" != "$main_max" ]; then
  erro "a versão máxima da referência ($ref_max) não é a última migration da main ($main_max) — aceitação abortada; rode o Montar da vaga 1"
fi

# ── Ledgers/chaves da comparação ─────────────────────────────────────────────────────────────────────────────────────
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select version from supabase_migrations.schema_migrations order by 1" | sort > "$dir/vaga.led"
# (a) órfão = versão no ledger da vaga, AUSENTE na referência E que NÃO pertence a uma migration da main (P1: nunca remove
#     versão de migration presente na main). As versões da main estão todas na referência (P1 garantiu), mas subtraímos a
#     main explicitamente como trava redundante.
comm -13 "$dir/ref.led" "$dir/vaga.led" > "$dir/orphan.pre"
comm -23 "$dir/orphan.pre" "$dir/main.led" > "$dir/orphan.led"
norphan=$(grep -c . "$dir/orphan.led" || true)

cut -d'|' -f1 "$dir/ref.sig"  | sort -u > "$dir/ref.keys"
cut -d'|' -f1 "$dir/vaga.sig" | sort -u > "$dir/vaga.keys"
comm -13 "$dir/ref.keys" "$dir/vaga.keys" > "$dir/vaga_only.keys"   # (b) na vaga e NÃO na ref → objeto da PR (DROP)
comm -23 "$dir/ref.keys" "$dir/vaga.keys" > "$dir/ref_only.keys"    # (d) na ref e NÃO na vaga → estrutural → Montar
comm -3 "$dir/ref.sig" "$dir/vaga.sig" | sed 's/^[[:space:]]*//' | cut -d'|' -f1 | sort -u > "$dir/changed.all"
comm -12 "$dir/changed.all" "$dir/ref.keys" | comm -12 - "$dir/vaga.keys" > "$dir/diff.keys"  # em ambos, assinatura diferente

# (d) irreversível com segurança ANTES de tocar em nada: objeto aprovado ausente na vaga (tabela/coluna/etc.).
if [ -s "$dir/ref_only.keys" ]; then
  echo "objeto(s) da referência AUSENTE(s) na vaga (diferença estrutural — tabela/coluna/etc.):"; sed 's/^/  - /' "$dir/ref_only.keys" | head
  montar "a vaga não tem objeto(s) aprovado(s) da referência — correção cirúrgica seria insegura (tabela de referência ausente ou colunas diferem)"
fi
# diff só é corrigível quando é função (def/perm), view, ou PERMISSÃO de função (grant-fn). Qualquer outra classe → Montar.
if grep -qvE '^(func|view|grant-fn) ' "$dir/diff.keys" 2>/dev/null; then
  echo "objeto(s) MODIFICADO(s) de classe não corrigível (só função/view/permissão-de-função):"; grep -vE '^(func|view|grant-fn) ' "$dir/diff.keys" | sed 's/^/  - /' | head
  montar "objeto modificado que não é função/view/permissão-de-função (ex.: tabela, coluna, tipo, policy, trigger)"
fi

# testemunha (RD-38): hash da definição de $WITNESS na vaga ANTES e na referência.
w_vaga_antes=$({ grep -E "^func public\.${WITNESS}\(" "$dir/vaga.sig" || true; } | head -1 | cut -d'|' -f2)
w_ref=$({ grep -E "^func public\.${WITNESS}\(" "$dir/ref.sig" || true; } | head -1 | cut -d'|' -f2)

nd=$(grep -c . "$dir/vaga_only.keys" || true)
ndiff=$(grep -c . "$dir/diff.keys" || true)
nchanges=$(( nd + ndiff + norphan ))

if [ "$nchanges" -eq 0 ]; then
  echo "vaga ${VAGA}: já idêntica à referência (objetos) e sem órfãos no ledger — nada a reconciliar."
else
  # tabelas que serão derrubadas: os filhos delas somem junto no DROP TABLE (sem precisar de CASCADE) — não emitir drop
  # de filho de tabela-nova.
  { grep '^table ' "$dir/vaga_only.keys" || true; } | sed 's/^table //' | sort -u > "$dir/tdrop.names"
  pertence_a_tabela_nova() { grep -qxF "$1" "$dir/tdrop.names"; }

  txn="$dir/restore.sql"
  {
    echo "\\set ON_ERROR_STOP on"
    echo "begin;"
    echo "set local statement_timeout='180s'; set local lock_timeout='20s';"
  } > "$txn"
  # (b) DROP dos objetos vaga-only — SEM CASCADE, SEMPRE no schema public, em ORDEM DE DEPENDÊNCIA (dependentes primeiro):
  #     policy → trigger → constraint → index → coluna → view → tabela → sequence → tipo → função.
  #     Um DROP que falhar por dependência aborta a transação (ON_ERROR_STOP) → caso (d) Montar (não remenda com cascade).
  emitir() {
    local classe="$1" k
    while IFS= read -r k; do
      [ -z "$k" ] && continue
      case "$k" in
        "policy "*)   pn=${k#policy }; pl=${pn% on *}; tbl=${pn#* on }; pertence_a_tabela_nova "$tbl" || { echo "drop policy if exists \"$pl\" on public.\"$tbl\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP policy $pl em public.$tbl"; };;
        "trigger "*)  tn=${k#trigger }; tg=${tn% on *}; tbl=${tn#* on }; pertence_a_tabela_nova "$tbl" || { echo "drop trigger if exists \"$tg\" on public.\"$tbl\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP trigger $tg em public.$tbl"; };;
        "constraint "*) cn=${k#constraint }; con=${cn% on *}; tbl=${cn#* on }; pertence_a_tabela_nova "$tbl" || { echo "alter table if exists public.\"$tbl\" drop constraint if exists \"$con\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP constraint $con em public.$tbl"; };;
        "index "*)    echo "drop index if exists public.\"${k#index }\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP índice public.${k#index }";;
        "col "*)      tc=${k#col }; t=${tc%%.*}; c=${tc#*.}; pertence_a_tabela_nova "$t" || { echo "alter table if exists public.\"$t\" drop column if exists \"$c\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP coluna public.$t.$c"; };;
        "view "*)     echo "drop view if exists public.\"${k#view }\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP view public.${k#view }";;
        "table "*)    echo "drop table if exists public.\"${k#table }\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP tabela public.${k#table }";;
        "sequence "*) echo "drop sequence if exists public.\"${k#sequence }\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP sequence public.${k#sequence }";;
        "type "*)     echo "drop type if exists public.\"${k#type }\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP tipo public.${k#type }";;
        "func "*)     echo "drop function if exists ${k#func };" >> "$txn"; resumo "- vaga ${VAGA}: DROP função ${k#func } (só na vaga, não na referência)";;
        "rls "*)      ;;  # rls só é vaga-only se a tabela for nova → some no DROP TABLE
        "grant-"*)    ;;  # grant de objeto novo some com o objeto; grant de objeto existente é diff → cai abaixo
        *) montar "classe vaga-only não tratável: $k";;
      esac
    done < <(grep "^${classe} " "$dir/vaga_only.keys" || true)
  }
  for classe in policy trigger constraint index col view table sequence type func; do emitir "$classe"; done
  # qualquer classe vaga-only inesperada (que não seja uma das acima nem rls/grant-) → não sabemos tratar sem cascade → Montar
  if grep -qvE '^(policy|trigger|constraint|index|col|view|table|sequence|type|func|rls|grant-) ' "$dir/vaga_only.keys" 2>/dev/null; then
    montar "classe vaga-only não tratável sem CASCADE: $(grep -vE '^(policy|trigger|constraint|index|col|view|table|sequence|type|func|rls|grant-) ' "$dir/vaga_only.keys" | head -1)"
  fi
  # (c) FUNÇÃO/VIEW modificada, ou PERMISSÃO de função diferente → recria/reaplica a partir da REFERÊNCIA (SELECT só leitura).
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    case "$k" in
      "func "*) sig=${k#func }
        ddl=$("$PSQL" "$REF_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; select pg_get_functiondef('$sig'::regprocedure)")
        gr=$("$PSQL" "$REF_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; select coalesce(string_agg(format('grant %s on function %s to %s;', a.privilege_type, '$sig'::regprocedure, case when a.grantee=0 then 'public' else a.grantee::regrole::text end), ' '), '') from aclexplode((select proacl from pg_proc where oid='$sig'::regprocedure)) a")
        printf '%s;\n' "$ddl" >> "$txn"
        echo "revoke all on function ${sig} from public, anon, authenticated, service_role;" >> "$txn"
        [ -z "$gr" ] || printf '%s\n' "$gr" >> "$txn"
        resumo "- vaga ${VAGA}: RECRIA função ${sig} a partir da referência (definição + permissões)";;
      "view "*) vn=${k#view }
        def=$("$PSQL" "$REF_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; select pg_get_viewdef('public.\"$vn\"'::regclass, true)")
        printf 'create or replace view public."%s" as %s;\n' "$vn" "$def" >> "$txn"
        resumo "- vaga ${VAGA}: RECRIA view public.${vn} a partir da referência";;
      "grant-fn "*) sig=${k#grant-fn }
        gr=$("$PSQL" "$REF_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; select coalesce(string_agg(format('grant %s on function %s to %s;', a.privilege_type, '$sig'::regprocedure, case when a.grantee=0 then 'public' else a.grantee::regrole::text end), ' '), '') from aclexplode((select proacl from pg_proc where oid='$sig'::regprocedure)) a")
        echo "revoke all on function ${sig} from public, anon, authenticated, service_role;" >> "$txn"
        [ -z "$gr" ] || printf '%s\n' "$gr" >> "$txn"
        resumo "- vaga ${VAGA}: REAPLICA permissões da função ${sig} a partir da referência";;
    esac
  done < "$dir/diff.keys"
  # (a) LEDGER: remove os ÓRFÃOS (versões da vaga ausentes na referência E ausentes na main). Carrega o ledger da
  #     referência e as versões da main em temps e apaga só o que não estiver em nenhum dos dois — jamais toca versão de
  #     migration da main (P1).
  cp "$dir/ref.led" "$dir/ref.led.copy"; cp "$dir/main.led" "$dir/main.led.copy"
  {
    echo "create temp table _refled(version text) on commit drop;"
    echo "\\copy _refled(version) from '$dir/ref.led.copy'"
    echo "create temp table _mainled(version text) on commit drop;"
    echo "\\copy _mainled(version) from '$dir/main.led.copy'"
    echo "delete from supabase_migrations.schema_migrations where version not in (select version from _refled) and version not in (select version from _mainled);"
  } >> "$txn"
  [ "$norphan" -eq 0 ] || resumo "- vaga ${VAGA}: REMOVE ${norphan} versão(ões) órfã(s) do ledger (na vaga, ausentes na referência e na main): $(tr '\n' ' ' < "$dir/orphan.led")"
  # VERIFY-BEFORE-COMMIT: a assinatura viva da vaga tem de ficar IGUAL à da referência E sem órfão no ledger; senão
  # RAISE → ROLLBACK (a vaga fica intacta e contaminada) → cai no exit 2 "precisa de Montar".
  cp "$dir/ref.sig" "$dir/ref.sig.copy"
  {
    echo "create temp table _refsig(sig text) on commit drop;"
    echo "\\copy _refsig(sig) from '$dir/ref.sig.copy'"
    echo "create temp table _vagasig on commit drop as $SIG;"
    echo "do \$v\$ declare d bigint; begin"
    echo "  select count(*) into d from ((select sig from _refsig except select sig from _vagasig) union all (select sig from _vagasig except select sig from _refsig)) x;"
    echo "  if d <> 0 then raise exception 'reconcilia-ref: vaga nao convergiu para a referencia (% diferenca(s) de assinatura)', d; end if;"
    echo "end \$v\$;"
    echo "do \$l\$ declare n bigint; begin"
    echo "  select count(*) into n from supabase_migrations.schema_migrations where version not in (select version from _refled) and version not in (select version from _mainled);"
    echo "  if n <> 0 then raise exception 'reconcilia-ref: ainda ha % orfao(s) no ledger (versao ausente na referencia e na main)', n; end if;"
    echo "end \$l\$;"
    echo "commit;"
  } >> "$txn"

  echo "reconciliando a vaga ${VAGA} com a referência: $nd objeto(s) vaga-only a derrubar (sem cascade), $ndiff função/view/permissão a reaplicar da referência, ${norphan} órfão(s) de ledger a remover…"
  if ! "$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$txn"; then
    montar "a reconciliação não convergiu (DROP com dependência sem CASCADE, RAISE ou erro → ROLLBACK; a vaga ficou intacta) — recrie com o Montar"
  fi
fi

# Contadores (sequences) alinhados ao dado da vaga (idempotente), reconciliou ou não.
TEST_DATABASE_URL="$TEST_DATABASE_URL" PSQL="${PSQL:-psql}" "$(dirname "$0")/acertar-sequences.sh"

# ── VERIFICAÇÃO FINAL OBRIGATÓRIA (RD-38): no dado, pós-tudo, a vaga TEM de estar igual à referência; senão Montar. ──
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "$SIG" | sort > "$dir/vaga.final.sig"
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select version from supabase_migrations.schema_migrations order by 1" | sort > "$dir/vaga.final.led"
sig_div=$(comm -3 "$dir/ref.sig" "$dir/vaga.final.sig" | grep -c . || true)
# órfão final = versão na vaga, ausente na referência e na main
orphan_fim=$(comm -13 "$dir/ref.led" "$dir/vaga.final.led" | comm -23 - "$dir/main.led" | grep -c . || true)
w_vaga_depois=$({ grep -E "^func public\.${WITNESS}\(" "$dir/vaga.final.sig" || true; } | head -1 | cut -d'|' -f2)

resumo "### Reconciliação da vaga ${VAGA} → referência (vaga 1, só leitura) — verificação final obrigatória"
resumo ""
resumo "| item | antes | depois | referência |"
resumo "| --- | --- | --- | --- |"
resumo "| ledger (órfãos: versões ausentes na referência e na main) | ${norphan} | ${orphan_fim} | 0 |"
resumo "| assinaturas divergentes da referência (public, sem objetos de extensão) | — | ${sig_div} | 0 |"
resumo "| md5 pg_get_functiondef(${WITNESS}) | ${w_vaga_antes:-ausente} | ${w_vaga_depois:-ausente} | ${w_ref:-ausente} |"

if [ "$sig_div" -ne 0 ] || [ "$orphan_fim" -ne 0 ]; then
  montar "verificação final no dado: vaga ainda difere da referência (assinaturas divergentes=${sig_div}, órfãos no ledger=${orphan_fim})"
fi
echo "vaga ${VAGA}: reconciliada e VERIFICADA no dado (objetos do public == referência; nenhum órfão no ledger)."
exit 0
