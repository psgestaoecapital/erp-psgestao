#!/usr/bin/env bash
# CEO 14/10 — a aceitação SUJAVA a vaga a cada PR: o passo de sync roda `supabase db push` sobre o CHECKOUT (a PR), então
# as migrations da PR eram aplicadas e NADA as desfazia. A próxima PR herdava schema NÃO aprovado; e, quando a versão da
# PR ficava > a maior da main, a guarda de contaminação mandava "recriar" → toda aceitação na vaga saía vermelha.
#
# Solução SEM segredo de produção (Pilar 2): a própria vaga, logo APÓS o sync só-da-main e ANTES das migrations da PR, é a
# referência. Tiramos uma FOTO (schema _vaga_snapshot) do estado "main"; ao fim (if: always()) restauramos a vaga a essa
# foto — DROP do que a PR criou, redefinição de função/view alterada para a definição da foto, remoção das linhas de
# catálogo que a PR inseriu e das versions da PR no ledger — e só terminamos limpos se, no dado, a vaga == a foto; senão
# exit 2 "precisa de recriar" (o Montar é a rede). NUNCA termina verde deixando a vaga diferente da foto.
#
# Uso: VAGA=N  TEST_DATABASE_URL=<vaga pooler, ESCRITA>  MAIN_MIGR_DIR=<dir origin/main>  [CHECKOUT_MIGR_DIR=supabase/migrations]
#      [PSQL=psql]  vaga-snapshot.sh  snapshot|restaurar
# exit 0 = ok · exit 2 = vaga precisa de recriar · exit 1 = erro de uso/guarda. Só escreve na vaga (teste), nunca na produção.
set -euo pipefail
MODO="${1:?uso: vaga-snapshot.sh snapshot|restaurar}"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}" "${MAIN_MIGR_DIR:?MAIN_MIGR_DIR ausente}"
CHECKOUT_MIGR_DIR="${CHECKOUT_MIGR_DIR:-supabase/migrations}"
PSQL="${PSQL:-psql}"
VAGA="${VAGA:-?}"
PROD_REF=horsymhsinqcimflrtjo
export LC_ALL=C
erro()    { echo "::error::$*"; exit 1; }
recriar() { echo "::error::vaga ${VAGA} precisa de recriar: $*"; exit 2; }
resumo()  { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY" || true; echo "$*"; }

# Nunca escreve na produção; destino é Session pooler de teste.
case "$TEST_DATABASE_URL" in *"$PROD_REF"*) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado";; esac
case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) erro "vaga ${VAGA}: TEST_DATABASE_URL precisa ser Session pooler";; esac

# Assinatura ABRANGENTE do public (igual à do reconciliar-vaga.sh): chave|hash por objeto de código/estrutura.
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

# migrations NOVAS da PR = arquivos no checkout que NÃO estão em origin/main (por basename).
pr_migr_files() {
  local f b
  for f in "$CHECKOUT_MIGR_DIR"/*.sql; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    [ -e "$MAIN_MIGR_DIR/$b" ] || printf '%s\n' "$f"
  done
}
# tabelas APPEND-ONLY (RD-54: trigger bloqueia DELETE/UPDATE) ficam FORA da foto e da restauração — migration/teste só
# acrescenta linhas e isso não suja a vaga; restaurar por DELETE falhava e re-sujava a vaga (Eng. Chefe 18/10). Sem bypass de trigger.
APPEND_ONLY_RE='audit_log_global'
# tabelas que as migrations da PR populam (INSERT INTO [public.]<tabela>) — catálogo a restaurar (ex.: erp_ajuda_campo).
pr_insert_tables() {
  local files; files=$(pr_migr_files)
  [ -n "$files" ] || return 0
  # shellcheck disable=SC2086
  grep -hioE 'insert[[:space:]]+into[[:space:]]+(public\.)?"?[a-z_][a-z0-9_]*"?' $files 2>/dev/null \
    | sed -E 's/.*into[[:space:]]+//I; s/public\.//I; s/"//g' | tr 'A-Z' 'a-z' | sort -u \
    | grep -vxE "$APPEND_ONLY_RE" || true
}

dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT

if [ "$MODO" = "snapshot" ]; then
  prfiles=$(pr_migr_files || true)
  if [ -z "$prfiles" ]; then
    echo "vaga ${VAGA}: a PR não traz migration nova — snapshot marca 'sem PR' (restaurar será no-op)."
  fi
  cattabs=$(pr_insert_tables || true)
  # grava a FOTO no schema _vaga_snapshot (idempotente: dropa e recria).
  snap="$dir/snapshot.sql"
  {
    echo "\\set ON_ERROR_STOP on"
    echo "begin;"
    echo "drop schema if exists _vaga_snapshot cascade;"
    echo "create schema _vaga_snapshot;"
    echo "create table _vaga_snapshot.sig as $SIG;"
    echo "create table _vaga_snapshot.fndef as select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, (select string_agg(format('grant %s on function %s to %s;', a.privilege_type, p.oid::regprocedure, case when a.grantee=0 then 'public' else a.grantee::regrole::text end), ' ') from aclexplode(p.proacl) a) as grants from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p','w');"
    echo "create table _vaga_snapshot.viewdef as select c.relname::text as relname, pg_get_viewdef(c.oid,true) as def from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m');"
    # defs de constraint/índice/trigger (Eng. Chefe 15/10: CHECK ampliado por DO $$ da PR do Hub deixava a vaga suja — modificado
    # de classe "não restaurável" caía em recriar SEM tocar o ledger). Agora a classe é revertida à def da foto.
    echo "create table _vaga_snapshot.condef as select con.conname::text||' on '||rel.relname::text as k, pg_get_constraintdef(con.oid) as def from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public';"
    echo "create table _vaga_snapshot.idxdef as select c.relname::text as k, pg_get_indexdef(c.oid) as def from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='i';"
    echo "create table _vaga_snapshot.trgdef as select t.tgname::text||' on '||c.relname::text as k, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;"
    echo "create table _vaga_snapshot.led as select version from supabase_migrations.schema_migrations;"
    echo "create table _vaga_snapshot.cattbl(tbl text);"
    echo "create table _vaga_snapshot.catrow(tbl text, h text);"
  } > "$snap"
  # catálogo: para cada tabela que a PR popula e que EXISTE agora, guarda o hash de cada linha (md5 da linha inteira).
  n_cat=0
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    # só tabelas reais do public (evita alvo inválido / injeção: nome já veio saneado do grep)
    exists=$("$PSQL" "$TEST_DATABASE_URL" -tAc "select to_regclass('public.\"$t\"') is not null")
    [ "$exists" = "t" ] || continue
    # tabela com trava de DELETE físico (RD-30, fn_bloqueia_delete_fisico: erp_pagar etc.) não se restaura por DELETE —
    # fica fora da foto, como as append-only (19/10: a menção a "INSERT INTO erp_pagar" numa migration da PR re-sujava a vaga 0).
    guarded=$("$PSQL" "$TEST_DATABASE_URL" -tAc "select exists(select 1 from pg_trigger g join pg_proc p on p.oid=g.tgfoid where g.tgrelid=to_regclass('public.\"$t\"') and not g.tgisinternal and p.proname='fn_bloqueia_delete_fisico')")
    [ "$guarded" = "t" ] && { echo "vaga ${VAGA}: $t tem trava de DELETE físico (RD-30) — fora da foto de catálogo."; continue; }
    n_cat=$((n_cat+1))
    {
      echo "insert into _vaga_snapshot.cattbl values ('$t');"
      echo "insert into _vaga_snapshot.catrow select '$t', md5(x::text) from public.\"$t\" x;"
    } >> "$snap"
  done <<< "$cattabs"
  echo "commit;" >> "$snap"
  "$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$snap" || erro "falha ao gravar a foto _vaga_snapshot"
  nled=$("$PSQL" "$TEST_DATABASE_URL" -tAc "select count(*) from _vaga_snapshot.led")
  echo "vaga ${VAGA}: foto _vaga_snapshot gravada (ledger=${nled}; $(printf '%s' "$prfiles" | grep -c . || true) migration(ões) de PR; ${n_cat} tabela(s) de catálogo da PR)."
  exit 0
fi

[ "$MODO" = "restaurar" ] || erro "modo inválido: $MODO (use snapshot|restaurar)"

# Sem foto (snapshot não rodou — ex.: run abortou antes) → nada a desfazer com segurança aqui; a guarda de contaminação
# (reconciliar-vaga.sh) no passo seguinte decide. Não falha por isso.
has=$("$PSQL" "$TEST_DATABASE_URL" -tAc "select to_regclass('_vaga_snapshot.sig') is not null" 2>/dev/null || echo f)
if [ "$has" != "t" ]; then
  echo "vaga ${VAGA}: sem _vaga_snapshot (snapshot não rodou) — nada a restaurar aqui; a guarda de contaminação decide."
  exit 0
fi

"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select sig from _vaga_snapshot.sig" | sort > "$dir/foto.sig"
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "$SIG" | sort > "$dir/agora.sig"
cut -d'|' -f1 "$dir/foto.sig"  | sort -u > "$dir/foto.keys"
cut -d'|' -f1 "$dir/agora.sig" | sort -u > "$dir/agora.keys"
comm -13 "$dir/foto.keys" "$dir/agora.keys" > "$dir/criou.keys"   # agora e não na foto → a PR criou (DROP)
comm -23 "$dir/foto.keys" "$dir/agora.keys" > "$dir/sumiu.keys"   # na foto e não agora → a PR DROPou objeto aprovado
comm -3 "$dir/foto.sig" "$dir/agora.sig" | sed 's/^[[:space:]]*//' | cut -d'|' -f1 | sort -u > "$dir/mud.all"
comm -12 "$dir/mud.all" "$dir/foto.keys" | comm -12 - "$dir/agora.keys" > "$dir/mud.keys"  # em ambos, diferente

# Função sumida (ex.: PR que troca a assinatura com DROP+CREATE do mesmo nome) é recriada do DDL da foto (passo 2b).
# View/tabela/tipo/etc. sumidos continuam exigindo recriar: restauração parcial seria insegura.
{ grep '^func ' "$dir/sumiu.keys" || true; } > "$dir/sumiu.func"
{ grep -v '^func ' "$dir/sumiu.keys" || true; } > "$dir/sumiu.outros"
if [ -s "$dir/sumiu.outros" ]; then
  echo "a PR removeu objeto(s) que havia na foto (não restauramos recriação por aqui):"; sed 's/^/  - /' "$dir/sumiu.outros" | head
  recriar "a PR fez DROP/rename de objeto aprovado — restauração parcial seria insegura; rode o Montar (recriar)"
fi
if grep -qvE '^(func|view|constraint|index|trigger) ' "$dir/mud.keys" 2>/dev/null; then
  echo "objeto MODIFICADO de classe não restaurável por aqui (só função/view/constraint/índice/trigger):"; grep -vE '^(func|view|constraint|index|trigger) ' "$dir/mud.keys" | sed 's/^/  - /' | head
  recriar "objeto modificado de classe não restaurável (policy/coluna/grant/tipo/rls)"
fi

{ grep '^table ' "$dir/criou.keys" || true; } | sed 's/^table //' | sort -u > "$dir/tdrop.names"
pertence_a_tabela_nova() { grep -qxF "$1" "$dir/tdrop.names"; }

txn="$dir/restore.sql"
{ echo "\\set ON_ERROR_STOP on"; echo "begin;"; echo "set local statement_timeout='10min'; set local lock_timeout='20s';"
  # pg_trgm (similarity etc.) vive em extensions/public: sem isto a recriação de view/função/índice que a usa falha
  # com "function similarity(text,text) does not exist" e a vaga fica SUJA (19/10, drenagem parada).
  echo "set local search_path = public, extensions, pg_catalog;"; } > "$txn"
# 1) DROP do que a PR criou (objetos vaga-only em relação à foto)
nd=0
while IFS= read -r k; do
  [ -z "$k" ] && continue; nd=$((nd+1))
  case "$k" in
    "func "*)     echo "drop function if exists ${k#func } cascade;" >> "$txn";;
    "view "*)     echo "drop view if exists public.\"${k#view }\" cascade;" >> "$txn";;
    "table "*)    echo "drop table if exists public.\"${k#table }\" cascade;" >> "$txn";;
    "type "*)     echo "drop type if exists public.\"${k#type }\" cascade;" >> "$txn";;
    "sequence "*) echo "do \$d\$ begin drop sequence if exists public.\"${k#sequence }\" cascade; exception when dependent_objects_still_exist then null; end \$d\$;" >> "$txn";;
    "col "*)      tc=${k#col }; t=${tc%%.*}; c=${tc#*.}; pertence_a_tabela_nova "$t" || echo "alter table if exists public.\"$t\" drop column if exists \"$c\" cascade;" >> "$txn";;
    # índice que sustenta PK/UNIQUE (ou de tabela nova, derrubada adiante) não se derruba sozinho (2BP01): o DROP da
    # constraint/tabela já o leva; a verificação antes do COMMIT garante que nada sobrou.
    "index "*)    echo "do \$d\$ begin drop index if exists public.\"${k#index }\" cascade; exception when dependent_objects_still_exist then null; end \$d\$;" >> "$txn";;
    "constraint "*) cn=${k#constraint }; con=${cn% on *}; tbl=${cn#* on }; pertence_a_tabela_nova "$tbl" || echo "alter table if exists public.\"$tbl\" drop constraint if exists \"$con\";" >> "$txn";;
    "trigger "*)  tn=${k#trigger }; tg=${tn% on *}; tbl=${tn#* on }; pertence_a_tabela_nova "$tbl" || echo "drop trigger if exists \"$tg\" on public.\"$tbl\";" >> "$txn";;
    "policy "*)   pn=${k#policy }; pl=${pn% on *}; tbl=${pn#* on }; pertence_a_tabela_nova "$tbl" || echo "drop policy if exists \"$pl\" on public.\"$tbl\";" >> "$txn";;
    "rls "*)      ;;
    "grant-"*)    ;;
    *) recriar "classe criada pela PR não tratável: $k";;
  esac
done < "$dir/criou.keys"
# 2) FUNÇÕES/VIEWS modificadas pela PR → volta à definição da FOTO (lida de _vaga_snapshot)
nr=0
while IFS= read -r k; do
  [ -z "$k" ] && continue; nr=$((nr+1))
  case "$k" in
    "func "*) sig=${k#func }
      ddl=$("$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select def from _vaga_snapshot.fndef where sig = \$x\$${sig}\$x\$")
      [ -n "$ddl" ] && printf '%s;\n' "$ddl" >> "$txn" || recriar "sem definição da foto p/ função $sig";;
    "view "*) vn=${k#view }
      def=$("$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select def from _vaga_snapshot.viewdef where relname = \$x\$${vn}\$x\$")
      [ -n "$def" ] && printf 'create or replace view public."%s" as %s;\n' "$vn" "$def" >> "$txn" || recriar "sem definição da foto p/ view $vn";;
    "constraint "*) cn=${k#constraint }; con=${cn% on *}; tbl=${cn#* on }
      def=$("$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select def from _vaga_snapshot.condef where k = \$x\$${cn}\$x\$")
      [ -n "$def" ] && printf 'alter table public."%s" drop constraint "%s"; alter table public."%s" add constraint "%s" %s;\n' "$tbl" "$con" "$tbl" "$con" "$def" >> "$txn" || recriar "sem definição da foto p/ constraint $cn";;
    "index "*) ix=${k#index }
      def=$("$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select def from _vaga_snapshot.idxdef where k = \$x\$${ix}\$x\$")
      [ -n "$def" ] && printf 'drop index public."%s"; %s;\n' "$ix" "$def" >> "$txn" || recriar "sem definição da foto p/ índice $ix";;
    "trigger "*) tn=${k#trigger }; tg=${tn% on *}; tbl=${tn#* on }
      def=$("$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select def from _vaga_snapshot.trgdef where k = \$x\$${tn}\$x\$")
      [ -n "$def" ] && printf 'drop trigger "%s" on public."%s"; %s;\n' "$tg" "$tbl" "$def" >> "$txn" || recriar "sem definição da foto p/ trigger $tn";;
  esac
done < "$dir/mud.keys"
# 2b) FUNÇÕES que a PR dropou (sumiram) → recriadas do DDL da foto, com os grants da foto
nf=0
while IFS= read -r k; do
  [ -z "$k" ] && continue; nf=$((nf+1)); sig=${k#func }
  ddl=$("$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select def from _vaga_snapshot.fndef where sig = \$x\$${sig}\$x\$")
  [ -n "$ddl" ] || recriar "sem definição da foto p/ função sumida $sig"
  printf '%s;\n' "$ddl" >> "$txn"
  echo "revoke all on function ${sig} from public, anon, authenticated, service_role;" >> "$txn"
  gr=$("$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "select coalesce(grants,'') from _vaga_snapshot.fndef where sig = \$x\$${sig}\$x\$")
  [ -z "$gr" ] || printf '%s\n' "$gr" >> "$txn"
done < "$dir/sumiu.func"
# 3) CATÁLOGO: apaga as linhas que a PR inseriu (linhas de hoje cujo md5 não está na foto), por tabela fotografada.
while IFS= read -r t; do
  [ -z "$t" ] && continue
  echo "delete from public.\"$t\" x where md5(x::text) not in (select h from _vaga_snapshot.catrow where tbl = \$x\$${t}\$x\$);" >> "$txn"
done < <("$PSQL" "$TEST_DATABASE_URL" -tAc "select tbl from _vaga_snapshot.cattbl")
# 4) LEDGER: remove as versions da PR (tudo que não estava na foto).
echo "delete from supabase_migrations.schema_migrations where version not in (select version from _vaga_snapshot.led);" >> "$txn"
# 5) VERIFY-BEFORE-COMMIT: a assinatura viva tem de voltar a ser IGUAL à da foto e o ledger idem; senão RAISE → ROLLBACK.
# A foto foi tirada com o search_path PADRÃO da sessão; pg_get_*def e information_schema.columns.column_default
# escrevem os nomes conforme o search_path (ex.: nextval('x_seq') × nextval('public.x_seq')). Com o search_path do
# restore (public, extensions, pg_catalog — #2885) a conferência dava 1166 "diferenças" só em col (20/10) e TODA
# restauração de PR com migration falhava → vaga SUJA. Volta ao padrão da sessão antes de comparar.
{
  echo "set local search_path to default;"
  echo "create temp table _agora on commit drop as $SIG;"
  echo "do \$v\$ declare d bigint; begin"
  echo "  select count(*) into d from ((select sig from _vaga_snapshot.sig except select sig from _agora) union all (select sig from _agora except select sig from _vaga_snapshot.sig)) z;"
  echo "  if d <> 0 then raise exception 'vaga-snapshot: vaga nao voltou a foto (% diferenca(s) de assinatura)', d; end if;"
  echo "end \$v\$;"
  echo "do \$l\$ declare n bigint; begin"
  echo "  select count(*) into n from ((select version from supabase_migrations.schema_migrations except select version from _vaga_snapshot.led) union all (select version from _vaga_snapshot.led except select version from supabase_migrations.schema_migrations)) z;"
  echo "  if n <> 0 then raise exception 'vaga-snapshot: ledger nao voltou a foto (% diferenca(s))', n; end if;"
  echo "end \$l\$;"
  echo "commit;"
} >> "$txn"

echo "restaurando a vaga ${VAGA} à foto: $nd objeto(s) criado(s) pela PR a derrubar, $nr função/view a reverter, $nf função(ões) sumida(s) a recriar…"
# 1ª tentativa; se estourar timeout/falhar, UMA nova tentativa (a transação é atômica: ROLLBACK não deixa meia-restauração).
if ! "$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$txn"; then
  echo "::warning::vaga ${VAGA}: restauração falhou — tentando uma vez mais"
  sleep 5
  if ! "$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$txn"; then
    # marca a vaga como SUJA (schema fora do public: não entra na assinatura) para o pool/Reconciliar não a usarem.
    "$PSQL" "$TEST_DATABASE_URL" -tAc "create schema if not exists _vaga_suja; create table if not exists _vaga_suja.marca(em timestamptz default now(), motivo text); insert into _vaga_suja.marca(motivo) values ('restauracao da foto falhou 2x')" >/dev/null 2>&1 || true
    recriar "a restauração à foto não convergiu após 2 tentativas (RAISE/erro → ROLLBACK; vaga marcada SUJA em _vaga_suja.marca — Eng. Chefe: rode o Reconciliar/Recriar)"
  fi
fi

# VERIFICAÇÃO FINAL OBRIGATÓRIA (RD-38), no dado, pós-commit: nunca termina 0 se a vaga != foto.
"$PSQL" "$TEST_DATABASE_URL" -tA -v ON_ERROR_STOP=1 -c "$SIG" | sort > "$dir/fim.sig"
sig_div=$(comm -3 "$dir/foto.sig" "$dir/fim.sig" | grep -c . || true)
led_div=$("$PSQL" "$TEST_DATABASE_URL" -tAc "select count(*) from ((select version from supabase_migrations.schema_migrations except select version from _vaga_snapshot.led) union all (select version from _vaga_snapshot.led except select version from supabase_migrations.schema_migrations)) z")
resumo "### Desfazer migrations da PR na vaga ${VAGA} (verificação final)"
resumo ""
resumo "| item | valor |"
resumo "| --- | --- |"
resumo "| objetos da PR derrubados / funções-views revertidas | $nd / $nr |"
resumo "| assinaturas ainda divergentes da foto | ${sig_div} |"
resumo "| ledger divergente da foto | ${led_div} |"
if [ "$sig_div" -ne 0 ] || [ "$led_div" -ne 0 ]; then
  recriar "verificação final: a vaga não voltou à foto (assinaturas=${sig_div}, ledger=${led_div})"
fi
# limpa a foto (não faz parte do public; não afeta a assinatura, mas mantém a vaga arrumada).
"$PSQL" "$TEST_DATABASE_URL" -tAc "drop schema if exists _vaga_snapshot cascade; drop schema if exists _vaga_suja cascade" >/dev/null 2>&1 || true
echo "vaga ${VAGA}: migrations da PR DESFEITAS e verificado no dado (schema/ledger == foto pré-PR)."
exit 0
