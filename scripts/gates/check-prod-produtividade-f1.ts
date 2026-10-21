// Gate (revisor #2874) — prova estática das invariantes de segurança/LGPD da migration da Produtividade F1 (banco).
// Lê o arquivo da migration e exige, para não regredir numa edição futura:
//  (1) as 7 tabelas novas com RLS ligada, policy por empresa e REVOKE de anon (escrita só por RPC);
//  (2) LGPD: colaborador_documento (CPF) fora do alcance direto de authenticated; bucket privado;
//      storage sem SELECT/DELETE a authenticated e INSERT amarrado a uma prod_tarefa da própria empresa;
//  (3) fn_prod_video_subir recusa sem consentimento válido / revogado e no 11º vídeo (limite 10);
//  (4) fn_prod_produto_colar com p_gravar=false não grava (prévia) e, no UPDATE, não regride dado existente;
//  (5) fn_prod_apontar_hora valida etapa/tarefa/posto contra empresa/planta e é idempotente (NULLS NOT DISTINCT).
// Estático (sem rede/banco), conforme a regra "um arquivo por gate".
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// Acha a migration pelo sufixo: a fila de merge renumera a versão (20261019150030 -> 20261021130030) e o nome fixo quebrava o gate.
const ARQ = readdirSync('supabase/migrations').find((f) => f.endsWith('_prod_produtividade_f1_banco.sql'))
if (!ARQ) { console.error('✗ migration *_prod_produtividade_f1_banco.sql não encontrada'); process.exit(1) }
const SQL = readFileSync(`supabase/migrations/${ARQ}`, 'utf8')
const tem = (re: RegExp) => re.test(SQL)

const TABELAS = [
  'prod_tarefa', 'prod_apontamento_hora', 'prod_entrada_config', 'prod_custo_hora_config',
  'prod_video_consentimento', 'prod_tarefa_video', 'prod_tarefa_video_acesso',
]

// (1) 7 tabelas novas, RLS + policy por empresa + REVOKE anon
ok(TABELAS.length === 7, '(1) sete tabelas novas na lista do gate')
for (const t of TABELAS) {
  ok(tem(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`)), `(1) tabela ${t} criada (aditiva)`)
}
// RLS: ou pelo laço DO (FOREACH) das 6 com updated_at, ou explícito na append-only
ok(tem(/FOREACH t IN ARRAY ARRAY\[[\s\S]*?'prod_tarefa'[\s\S]*?'prod_tarefa_video'[\s\S]*?\]/),
  '(1) laço de RLS cobre as 6 tabelas com updated_at')
ok(tem(/ENABLE ROW LEVEL SECURITY', t\)/) && tem(/ALTER TABLE public\.prod_tarefa_video_acesso ENABLE ROW LEVEL SECURITY/),
  '(1) RLS ligada (laço + append-only prod_tarefa_video_acesso)')
ok(tem(/REVOKE ALL ON public\.%I FROM PUBLIC, anon/) && tem(/REVOKE ALL ON public\.prod_tarefa_video_acesso FROM PUBLIC, anon/),
  '(1) REVOKE ALL de PUBLIC, anon (laço + append-only)')
ok(tem(/get_user_company_ids\(\)\) OR public\.is_admin\(\)/),
  '(1) policy SELECT por empresa (get_user_company_ids) + is_admin')
ok(!tem(/GRANT[^\n]*TO anon/i), '(1) nenhum GRANT a anon')

// (2) LGPD + storage
ok(tem(/REVOKE SELECT \(colaborador_documento\) ON public\.prod_video_consentimento FROM authenticated/),
  '(2) CPF (colaborador_documento) revogado do SELECT direto de authenticated')
ok(tem(/INSERT INTO storage\.buckets[\s\S]*?'industria-produtividade'[\s\S]*?false\)/),
  '(2) bucket industria-produtividade privado (public=false)')
ok(tem(/CREATE POLICY prod_video_insert ON storage\.objects FOR INSERT/),
  '(2) policy de INSERT no storage existe')
ok(tem(/split_part\(name,'\/',2\)::uuid[\s\S]*?prod_tarefa/) || tem(/prod_tarefa t[\s\S]*?split_part\(name,'\/',2\)::uuid/),
  '(2) INSERT no storage exige prod_tarefa da própria empresa no 2º segmento do caminho')
ok(!tem(/CREATE POLICY prod_video_select ON storage\.objects FOR SELECT TO authenticated\s+USING \(bucket_id = 'industria-produtividade'\s*\)/),
  '(2) SELECT no storage NÃO é aberto a qualquer authenticated da empresa')
ok(tem(/CREATE POLICY prod_video_select ON storage\.objects FOR SELECT[\s\S]*?is_admin\(\)/),
  '(2) SELECT no storage restrito (is_admin; leitura comum sai por URL assinada via RPC)')
ok(!tem(/CREATE POLICY prod_video_delete ON storage\.objects/),
  '(2) sem policy de DELETE no storage para authenticated (exclusão por service_role/retenção)')

// (3) fn_prod_video_subir: consentimento obrigatório/revogado + limite de 10
ok(tem(/consentido = true AND c\.revogado_em IS NULL/) && tem(/RAISE EXCEPTION 'sem_consentimento'/),
  "(3) fn_prod_video_subir recusa sem consentimento válido (consentido=true e não revogado) → 'sem_consentimento'")
ok(tem(/v_qtd >= 10 THEN RAISE EXCEPTION 'limite_videos'/),
  "(3) fn_prod_video_subir bloqueia no 11º vídeo (limite 10 → 'limite_videos')")

// (4) fn_prod_produto_colar: prévia não grava + UPDATE não regride
ok(tem(/IF NOT p_gravar THEN RAISE EXCEPTION '__previa__'/),
  '(4) fn_prod_produto_colar com p_gravar=false não grava (caminho de prévia aborta a transação)')
ok(tem(/papel\s*=\s*coalesce\(v_papel,\s*public\.prod_produto\.papel\)/),
  '(4) UPDATE preserva papel existente quando a coluna colada vem vazia (não regride para acabado)')
ok(!tem(/papel = EXCLUDED\.papel/),
  '(4) UPDATE não usa EXCLUDED.papel (que traria o default acabado para dado existente)')

// (5) fn_prod_apontar_hora: valida FKs cruzadas + idempotência
ok(tem(/RAISE EXCEPTION 'posto_nao_encontrado'/) && tem(/RAISE EXCEPTION 'etapa_nao_encontrada'/) && tem(/RAISE EXCEPTION 'tarefa_nao_encontrada'/),
  '(5) fn_prod_apontar_hora valida posto/etapa/tarefa contra empresa/planta quando não nulos')
ok(tem(/UNIQUE NULLS NOT DISTINCT \(company_id, fluxo_id, posto_id, produto_id, data, hora\)/),
  '(5) apontamento idempotente mesmo sem posto (UNIQUE NULLS NOT DISTINCT)')

// Aditiva: sem DROP/DELETE de dado de cliente (DROP POLICY/TRIGGER e DROP de storage.objects são de policy, não de dado)
ok(!tem(/\bDROP TABLE\b/i) && !tem(/\bDELETE FROM public\./i) && !tem(/\bTRUNCATE\b/i),
  '(aditiva) sem DROP TABLE / DELETE / TRUNCATE de dado')

if (falhas) { console.error(`\n${falhas} falha(s) — invariantes da Produtividade F1 (banco)`); process.exit(1) }
console.log('\ncheck-prod-produtividade-f1: ok')
