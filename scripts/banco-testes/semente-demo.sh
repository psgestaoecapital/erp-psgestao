#!/usr/bin/env bash
# CEO 11/10 (sessão interativa; resposta às 2 decisões + refinamentos do Eng. Chefe): fecha o SEED GAP que deixava a
# aceitacao-main vermelha por DADO VAZIO (não regressão) no banco de testes novo (xjzqndnvjkdjyisuklpy, Micro/Pro).
# Roda DEPOIS do fn_demo_reset (as empresas DEMO já existem). Copia da PRODUÇÃO (só leitura) para o BANCO DE TESTES,
# sempre FILTRADO e com AUTOR NULO — nunca leva dado pessoal nem a memória real de agentes/CEO:
#
#   - erp_documento_vertical  (global de referência) — copia tudo, NULANDO criado_por/aprovado_por NA ORIGEM (as datas
#                              criado_em/aprovado_em ficam; o briefing usa a data, não o autor).
#   - demo_por_area           (mapa área→empresa DEMO) — copia só as linhas de empresa DEMO que existem no teste; exclui
#                              a linha 'ecommerce' (…007), que NÃO é DEMO no banco de testes (guard is_demo).
#   - atak_fonte_mapa         — SINTETIZA para a empresa DEMO de P&M (…002) usando os 17 mapas ATIVOS da produção (da
#                              empresa REAL 975365cc) só como TEMPLATE de config (dominio/tabela_origem/chave_fato_sql/
#                              watermark/parse/ordem/full_refresh); company_id→DEMO e ativo=true. NÃO copia a empresa real.
#                              (fn_atak_status monta `dominios` a partir de atak_fonte_mapa WHERE ativo — sem ela, vazio.)
#   - erp_contexto_projeto    — NUNCA a memória real (5k linhas de decisões/handoffs/CEO é sensível, Pilar 2/LGPD):
#                              semeia UMA linha SINTÉTICA de briefing (tag ponto-de-partida) só p/ briefing-blueprints.
#
# Travas iguais às do catalogos.sh: destino NUNCA é a produção; origem só a produção. Carga numa transação só, com
# session_replication_role=replica (triggers/FKs não disparam). Ao fim, confere (RD-38) que as tabelas-chave da semente
# não ficaram vazias — montagem incompleta falha o job (Ação 3), nunca sai verde com DEMO pela metade.
set -euo pipefail
: "${PROD_DATABASE_URL:?PROD_DATABASE_URL ausente}" "${TEST_DATABASE_URL:?TEST_DATABASE_URL ausente}"
PSQL="${PSQL:-psql}"
PROD_REF=horsymhsinqcimflrtjo
TEST_REF=xjzqndnvjkdjyisuklpy
DEMO_PM=b0700000-0000-4000-a000-000000000002        # Demonstração P&M — a empresa do atak-status-equipe-rls
ECOMMERCE=b0700000-0000-4000-a000-000000000007      # NÃO é demo no banco de testes → fora do demo_por_area
erro() { echo "::error::$*"; exit 1; }

# Mesmas travas de destino/origem do catalogos.sh.
case "$TEST_DATABASE_URL" in *"$PROD_REF"*) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO — abortado";; esac
# vaga 0 = o projeto erp-psgestao-testes conhecido; vaga > 0 = qualquer Session pooler que NÃO seja a produção (mesma
# regra do catalogos.sh e do passo "Trava de segurança" do montar-banco-testes.yml; ACEITACAO_VAGA vem do GITHUB_ENV).
if [ "${ACEITACAO_VAGA:-0}" = 0 ]; then
  case "$TEST_DATABASE_URL" in *"$TEST_REF"*) ;; *) erro "TEST_DATABASE_URL não é o projeto erp-psgestao-testes";; esac
else
  case "$TEST_DATABASE_URL" in *pooler.supabase.com*) ;; *) erro "vaga ${ACEITACAO_VAGA}: TEST_DATABASE_URL precisa ser Session pooler (*.pooler.supabase.com)";; esac
fi
case "$PROD_DATABASE_URL" in *"$PROD_REF"*) ;; *) erro "PROD_DATABASE_URL não é o projeto de produção";; esac
case "$PROD_DATABASE_URL" in *"$TEST_REF"*) erro "PROD_DATABASE_URL aponta para o banco de testes";; esac

dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT

# Produção: só leitura. Cada linha sai como UM jsonb num campo CSV (CSV cita/escapa com segurança — jsonb pode ter
# aspas/vírgulas/quebras). O autor é removido do jsonb NA ORIGEM, nunca sai da produção.
"$PSQL" "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "SET statement_timeout='30s'; COPY (SELECT (to_jsonb(t) - 'criado_por' - 'aprovado_por') FROM public.erp_documento_vertical t) TO STDOUT WITH (FORMAT csv)" \
  > "$dir/doc_vertical.csv"
"$PSQL" "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "SET statement_timeout='30s'; COPY (SELECT to_jsonb(t) FROM public.demo_por_area t WHERE t.company_id <> '$ECOMMERCE'::uuid) TO STDOUT WITH (FORMAT csv)" \
  > "$dir/demo_por_area.csv"
"$PSQL" "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "SET statement_timeout='30s'; COPY (SELECT to_jsonb(t) || jsonb_build_object('company_id','$DEMO_PM','ativo',true) FROM public.atak_fonte_mapa t WHERE t.ativo) TO STDOUT WITH (FORMAT csv)" \
  > "$dir/atak_mapa.csv"
for f in doc_vertical demo_por_area atak_mapa; do echo "$f: $(wc -l < "$dir/$f.csv") linha(s) da produção"; done

# Carga no TESTE: transação única, triggers/FKs off. jsonb_populate_record casa por nome de campo; campos ausentes
# (criado_por/aprovado_por) ficam NULL; (.*) expande na ordem das colunas da tabela.
# IMPORTANTE: o \copy do psql NÃO interpola variáveis (:'x') nos seus argumentos. Então o caminho do CSV é escrito
# LITERAL no script de carga (expandido pelo bash aqui) e rodado com psql -f — igual ao catalogos.sh. O corpo SQL
# abaixo não tem '$' nem crase, por isso o heredoc sem aspas é seguro.
cat > "$dir/carga.sql" <<SQL
BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '30s';
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE _doc (j jsonb) ON COMMIT DROP;
\copy _doc FROM '$dir/doc_vertical.csv' WITH (FORMAT csv)
CREATE TEMP TABLE _dpa (j jsonb) ON COMMIT DROP;
\copy _dpa FROM '$dir/demo_por_area.csv' WITH (FORMAT csv)
CREATE TEMP TABLE _atak (j jsonb) ON COMMIT DROP;
\copy _atak FROM '$dir/atak_mapa.csv' WITH (FORMAT csv)

DELETE FROM public.erp_documento_vertical;
INSERT INTO public.erp_documento_vertical
  SELECT (jsonb_populate_record(NULL::public.erp_documento_vertical, j)).* FROM _doc;

DELETE FROM public.demo_por_area;
INSERT INTO public.demo_por_area
  SELECT (jsonb_populate_record(NULL::public.demo_por_area, j)).* FROM _dpa;

DELETE FROM public.atak_fonte_mapa WHERE company_id = '$DEMO_PM'::uuid;
INSERT INTO public.atak_fonte_mapa
  SELECT (jsonb_populate_record(NULL::public.atak_fonte_mapa, j)).* FROM _atak;

-- erp_contexto_projeto: NUNCA a memória real. Só uma linha SINTÉTICA de briefing (ponto-de-partida).
DELETE FROM public.erp_contexto_projeto;
INSERT INTO public.erp_contexto_projeto (projeto, categoria, prioridade, status, titulo, descricao, tags, criado_por)
VALUES ('banco-testes', 'estrela_polar', 'media', 'ativo',
        'Ponto de partida (semente de testes)',
        'Registro sintético do banco de testes para o briefing de sessão. Sem dado real.',
        ARRAY['ponto-de-partida']::text[], 'semente-testes');
COMMIT;
SQL
"$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/carga.sql"

# Conferência (RD-38 · Ação 3): tabela-chave da semente vazia = montagem incompleta → falha o job.
falta=0
chk() {
  n=$("$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$2")
  echo "$1: ${n:-0}"
  [ "${n:-0}" -gt 0 ] || { echo "::error::semente vazia: $1"; falta=1; }
}
chk erp_documento_vertical_vigente "select count(*) from public.erp_documento_vertical where vigente is true"
chk demo_por_area                  "select count(*) from public.demo_por_area"
chk atak_fonte_mapa_demo           "select count(*) from public.atak_fonte_mapa where company_id='$DEMO_PM'::uuid and ativo"
chk contexto_ponto_de_partida      "select count(*) from public.erp_contexto_projeto where 'ponto-de-partida' = any(tags)"
# Passada de semente (CEO 11/10): dados que as specs não-@pos LEEM (não criam) e que vêm do fn_demo_reset por empresa.
# Só AVISO (::warning + resumo): mostra a mina antes de a spec cair, sem derrubar a montagem por algo fora da semente.
DEMO_BASE=b0700000-0000-4000-a000-00000000000
chkw() {
  n=$("$PSQL" "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "$2" 2>/dev/null || echo erro)
  echo "$1: ${n:-0}"
  case "$n" in erro|0|"") echo "::warning::semente: $1 vazio — specs que leem esse dado podem cair"; echo "- ⚠ $1 vazio" >> "${GITHUB_STEP_SUMMARY:-/dev/null}";; esac
}
chkw demo_oficina_os            "select count(*) from public.erp_os where company_id='${DEMO_BASE}1'::uuid"
chkw demo_ge_nfe_recebidas_forn "select count(*) from public.erp_nfe_recebidas where company_id='${DEMO_BASE}4'::uuid and chave_acesso is not null and fornecedor_id is not null"
chkw demo_ge_plano_contas       "select count(*) from public.erp_plano_contas where company_id='${DEMO_BASE}4'::uuid"
chkw demo_pm_timesheet          "select count(*) from public.agency_timesheet where company_id='$DEMO_PM'::uuid and job_id is not null"
chkw demo_sst_funcionario_abate "select count(*) from public.compliance_funcionarios where company_id='${DEMO_BASE}5'::uuid and setor='Abate'"
chkw demo_chamados_sugestoes    "select count(*) from public.sugestoes where status<>'arquivada' and coalesce(user_name,'')<>'robô aceitação'"
[ "$falta" = 0 ] || erro "semente-demo incompleta — alguma tabela-chave ficou vazia"

{
  echo "### Semente demo (globais/indicadores — filtrado, autor nulo, sintético)"
  echo "| tabela | origem | observação |"
  echo "|---|---|---|"
  echo "| erp_documento_vertical | produção (autores nulos) | global de referência |"
  echo "| demo_por_area | produção (sem a linha ecommerce/…007) | mapa área→empresa DEMO |"
  echo "| atak_fonte_mapa (…002) | config dos 17 ativos da prod (template) | sintetizado p/ a DEMO, sem empresa real |"
  echo "| erp_contexto_projeto | SINTÉTICO (ponto-de-partida) | memória real nunca é copiada |"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "semente-demo: ok"
