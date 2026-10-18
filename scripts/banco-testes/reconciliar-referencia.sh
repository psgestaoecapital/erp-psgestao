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
#   (a) LEDGER: versões que a vaga tem e a referência NÃO → remove do ledger da vaga (depois de remover os objetos);
#   (b) objetos do schema public na vaga e NÃO na referência (função, view, tabela, tipo, trigger, policy, índice,
#       constraint, coluna, sequence) → DROP na vaga;
#   (c) FUNÇÕES em ambos com DEFINIÇÃO e/ou PERMISSÕES diferentes → recria na vaga a partir da referência
#       (pg_get_functiondef + REVOKE/GRANT da referência); VIEW diferente → create or replace da referência;
#   (d) qualquer diff NÃO corrigível com segurança (objeto da referência AUSENTE na vaga — tabela/coluna/etc. — ou
#       objeto modificado que não é função/view/grant-de-função) → NÃO corrige: exit 2 "precisa de Montar". O chamador
#       dispara o Montar da vaga e marca a PR para re-rodar.
# Cada correção (vaga, objeto, ação) entra no resumo do job e no log. VERIFY-BEFORE-COMMIT na mesma transação + verificação
# final no dado (RD-38): nunca termina 0 se, no dado, a vaga ≠ referência.
#
# exit 0 = vaga reconciliada e VERIFICADA igual à referência (ou nada a fazer) · exit 2 = precisa de Montar · exit 1 = erro/guarda.
# Uso: VAGA=0|2  TEST_DATABASE_URL=<vaga alvo, pooler, ESCRITA>  REF_DATABASE_URL=<vaga 1, pooler, SÓ LEITURA>  [PSQL=psql]
#      [WITNESS=fn_ge_listagem_v2]  reconciliar-referencia.sh
set -uo pipefail
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}" "${REF_DATABASE_URL:?REF_DATABASE_URL ausente}"
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

# ── Assinatura ABRANGENTE dos objetos de código/estrutura do public (chave|hash). A MESMA do reconciliar-vaga.sh e do
#    vaga-snapshot.sh: "assinaturas iguais ⇒ esquema igual" no que importa. É o que a verificação final compara. ───────
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
union all select 'policy '||pol.polname||' on '||c.relname||'|'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'/'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')||'/'||pol.polcmd::text||'/'||array_to_string(coalesce(pol.polroles,'{}'),','))
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
union all select 'rls '||c.relname||'|'||c.relrowsecurity::text||c.relforcerowsecurity::text from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
union all select 'grant-rel '||c.relname||'|'||md5(coalesce(array_to_string(c.relacl,','),'')) from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S')
union all select 'grant-fn '||p.oid::regprocedure::text||'|'||md5(coalesce(array_to_string(p.proacl,','),'')) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p','w')
union all select 'type '||t.typname||'|'||t.typtype::text||'/'||coalesce((select string_agg(e.enumlabel,',' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),'')
  from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','c','d')
union all select 'sequence '||c.relname||'|' from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'"

set -e
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT

# A REFERÊNCIA é lida SÓ por SELECT (nunca -f, nunca DDL/DML), com timeout curto. A vaga é a única que recebe escrita.
"$PSQL" "$REF_DATABASE_URL"  -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; $SIG" | sort > "$dir/ref.sig"
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "$SIG" | sort > "$dir/vaga.sig"
[ -s "$dir/ref.sig" ] || erro "assinatura da referência vazia (leitura falhou)"

"$PSQL" "$REF_DATABASE_URL"  -tA -v ON_ERROR_STOP=1 -c "set statement_timeout='60s'; select version from supabase_migrations.schema_migrations order by 1" | sort > "$dir/ref.led"
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select version from supabase_migrations.schema_migrations order by 1" | sort > "$dir/vaga.led"
comm -13 "$dir/ref.led" "$dir/vaga.led" > "$dir/orphan.led"   # (a) na vaga e NÃO na referência → remover do ledger
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
  # tabelas que serão derrubadas: os filhos delas somem no CASCADE — não emitir drop de filho de tabela-nova.
  { grep '^table ' "$dir/vaga_only.keys" || true; } | sed 's/^table //' | sort -u > "$dir/tdrop.names"
  pertence_a_tabela_nova() { grep -qxF "$1" "$dir/tdrop.names"; }

  txn="$dir/restore.sql"
  {
    echo "\\set ON_ERROR_STOP on"
    echo "begin;"
    echo "set local statement_timeout='180s'; set local lock_timeout='20s';"
  } > "$txn"
  # (b) DROP dos objetos vaga-only — SEMPRE qualificados com public. (nunca toca outro schema).
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    case "$k" in
      "func "*)     echo "drop function if exists ${k#func } cascade;"  >> "$txn"; resumo "- vaga ${VAGA}: DROP função ${k#func } (só na vaga, não na referência)";;
      "view "*)     echo "drop view if exists public.\"${k#view }\" cascade;" >> "$txn"; resumo "- vaga ${VAGA}: DROP view public.${k#view }";;
      "table "*)    echo "drop table if exists public.\"${k#table }\" cascade;" >> "$txn"; resumo "- vaga ${VAGA}: DROP tabela public.${k#table }";;
      "type "*)     echo "drop type if exists public.\"${k#type }\" cascade;" >> "$txn"; resumo "- vaga ${VAGA}: DROP tipo public.${k#type }";;
      "sequence "*) echo "drop sequence if exists public.\"${k#sequence }\" cascade;" >> "$txn"; resumo "- vaga ${VAGA}: DROP sequence public.${k#sequence }";;
      "col "*)      tc=${k#col }; t=${tc%%.*}; c=${tc#*.}; pertence_a_tabela_nova "$t" || { echo "alter table if exists public.\"$t\" drop column if exists \"$c\" cascade;" >> "$txn"; resumo "- vaga ${VAGA}: DROP coluna public.$t.$c"; };;
      "index "*)    echo "do \$d\$ begin drop index if exists public.\"${k#index }\" cascade; exception when dependent_objects_still_exist then null; end \$d\$;" >> "$txn"; resumo "- vaga ${VAGA}: DROP índice public.${k#index }";;
      "constraint "*) cn=${k#constraint }; con=${cn% on *}; tbl=${cn#* on }; pertence_a_tabela_nova "$tbl" || { echo "alter table if exists public.\"$tbl\" drop constraint if exists \"$con\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP constraint $con em public.$tbl"; };;
      "trigger "*)  tn=${k#trigger }; tg=${tn% on *}; tbl=${tn#* on }; pertence_a_tabela_nova "$tbl" || { echo "drop trigger if exists \"$tg\" on public.\"$tbl\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP trigger $tg em public.$tbl"; };;
      "policy "*)   pn=${k#policy }; pl=${pn% on *}; tbl=${pn#* on }; pertence_a_tabela_nova "$tbl" || { echo "drop policy if exists \"$pl\" on public.\"$tbl\";" >> "$txn"; resumo "- vaga ${VAGA}: DROP policy $pl em public.$tbl"; };;
      "rls "*)      ;;  # rls só é vaga-only se a tabela for nova → some no CASCADE
      "grant-"*)    ;;  # grant de objeto novo some com o objeto; grant de objeto existente é diff → cai abaixo
      *) montar "classe vaga-only não tratável: $k";;
    esac
  done < "$dir/vaga_only.keys"
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
  # (a) LEDGER: remove os ÓRFÃOS (versões da vaga ausentes na referência). Carrega o ledger da referência num temp e apaga
  #     o que não estiver nele — jamais toca as versões que a referência também tem (as históricas aprovadas).
  cp "$dir/ref.led" "$dir/ref.led.copy"
  {
    echo "create temp table _refled(version text) on commit drop;"
    echo "\\copy _refled(version) from '$dir/ref.led.copy'"
    echo "delete from supabase_migrations.schema_migrations where version not in (select version from _refled);"
  } >> "$txn"
  [ "$norphan" -eq 0 ] || resumo "- vaga ${VAGA}: REMOVE ${norphan} versão(ões) órfã(s) do ledger (presentes na vaga, ausentes na referência): $(tr '\n' ' ' < "$dir/orphan.led")"
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
    echo "  select count(*) into n from supabase_migrations.schema_migrations where version not in (select version from _refled);"
    echo "  if n <> 0 then raise exception 'reconcilia-ref: ainda ha % orfao(s) no ledger (versao ausente na referencia)', n; end if;"
    echo "end \$l\$;"
    echo "commit;"
  } >> "$txn"

  echo "reconciliando a vaga ${VAGA} com a referência: $nd objeto(s) vaga-only a derrubar, $ndiff função/view/permissão a reaplicar da referência, ${norphan} órfão(s) de ledger a remover…"
  if ! "$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$txn"; then
    montar "a reconciliação não convergiu (RAISE/erro → ROLLBACK; a vaga ficou intacta e contaminada) — recrie com o Montar"
  fi
fi

# Contadores (sequences) alinhados ao dado da vaga (idempotente), reconciliou ou não.
TEST_DATABASE_URL="$TEST_DATABASE_URL" PSQL="${PSQL:-psql}" "$(dirname "$0")/acertar-sequences.sh"

# ── VERIFICAÇÃO FINAL OBRIGATÓRIA (RD-38): no dado, pós-tudo, a vaga TEM de estar igual à referência; senão Montar. ──
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "$SIG" | sort > "$dir/vaga.final.sig"
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select version from supabase_migrations.schema_migrations order by 1" | sort > "$dir/vaga.final.led"
sig_div=$(comm -3 "$dir/ref.sig" "$dir/vaga.final.sig" | grep -c . || true)
orphan_fim=$(comm -13 "$dir/ref.led" "$dir/vaga.final.led" | grep -c . || true)
w_vaga_depois=$({ grep -E "^func public\.${WITNESS}\(" "$dir/vaga.final.sig" || true; } | head -1 | cut -d'|' -f2)

resumo "### Reconciliação da vaga ${VAGA} → referência (vaga 1, só leitura) — verificação final obrigatória"
resumo ""
resumo "| item | antes | depois | referência |"
resumo "| --- | --- | --- | --- |"
resumo "| ledger (órfãos: versões ausentes na referência) | ${norphan} | ${orphan_fim} | 0 |"
resumo "| assinaturas divergentes da referência (public) | — | ${sig_div} | 0 |"
resumo "| md5 pg_get_functiondef(${WITNESS}) | ${w_vaga_antes:-ausente} | ${w_vaga_depois:-ausente} | ${w_ref:-ausente} |"

if [ "$sig_div" -ne 0 ] || [ "$orphan_fim" -ne 0 ]; then
  montar "verificação final no dado: vaga ainda difere da referência (assinaturas divergentes=${sig_div}, órfãos no ledger=${orphan_fim})"
fi
echo "vaga ${VAGA}: reconciliada e VERIFICADA no dado (objetos do public == referência; nenhum órfão no ledger)."
exit 0
