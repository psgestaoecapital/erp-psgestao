-- PDCA GE · Inventário (/dashboard/commerce/estoque, aud8 96) · DEMO "Comércio (GE)" (b0700000-0000-4000-a000-000000000004)
-- code-desenvolvedor-3 · RD-38 (provado no dado) · RD-69 (DEMO sem poluição de teste) · RD-97 (UPDATE = destrutivo → SENSÍVEL) · RD-98 p4 (exclusão rastreável)
--
-- PROBLEMA (provado no dado, read-only, 22/11/2026): a DEMO GE acumulou 2.916 inventários-lixo de TESTE em
-- erp_inventarios, TODOS status='cancelado', assinatura "E2E…"/"E2E segurança…"/"teste de aceitação", gerados pelo
-- spec de aceitação a cada ~20 min SEM teardown. Cresce sem limite (era ~2.357 em 13/11, 2.916 em 22/11). A tabela
-- NÃO tinha deleted_at (única irmã sem exclusão rastreável — RD-98 p4), então o lixo só era mascarado na LISTAGEM
-- por filtro de marcador em src/app/dashboard/commerce/estoque/page.tsx (não é apagável/rastreável).
--
-- PROVA RD-38 (classificação dos 2.916 inventários VIVOS da DEMO GE, 22/11, read-only):
--   TODOS 2.916 carregam marcador E2E  (numero ILIKE 'E2E%'  OU  observacoes ILIKE '%e2e%'/'%teste de aceita%')
--   TODOS 2.916 status='cancelado'     (nao_cancelado = 0)
--   NÃO existe nenhum inventário SEM marcador E2E (fora_sem_marcador = 0) → não há seed legítimo a proteger hoje.
--   → o purge atinge SÓ a assinatura de teste (E2E + cancelado); qualquer inventário real futuro (sem marcador) é
--     explicitamente preservado pela guarda da função.
--
-- FIX (RD-69, durável, igual ao padrão de #5747 fn_demo_ge_receber_purgar_lixo_teste):
--   (1) ADD COLUMN deleted_at em erp_inventarios (RD-98 p4 — exclusão rastreável e REVERSÍVEL);
--   (2) função de limpeza idempotente (soft-delete + backup) que remove o lixo de TESTE por assinatura — SÓ em
--       empresa is_demo, protegendo explicitamente qualquer inventário sem marcador de teste;
--   (3) chamada uma vez AGORA (limpa o estado atual de produção) e no bloco GE de fn_demo_reset (auto-cura a cada
--       reset → não re-acumula), ao lado da limpeza de cartões de teste que já existe ali.
-- Aditiva/idempotente: reexecutar não altera nada (guarda deleted_at IS NULL). Nenhum dado de cliente real é tocado
-- (empresa is_demo + assinatura de teste + proteção de inventário sem marcador). Soft-delete é rastreável e REVERSÍVEL.
-- A LISTAGEM continua escondendo o lixo pelo marcador (defesa mantida), então não há mudança de leitura/tela nesta PR.
-- Faixa de segundos :40 (code-desenvolvedor-3). PR SENSÍVEL (revisao-eng-chefe) → pede a etiqueta "so-demo".

-- ── (1) Exclusão rastreável: deleted_at em erp_inventarios (aditiva, nullable; RD-98 p4) ──
ALTER TABLE public.erp_inventarios ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── Cópia de segurança (reversível): ids + deleted_at antigo, antes de qualquer alteração ──
CREATE TABLE IF NOT EXISTS public.erp_inventario_lixo_teste_bkp_c3 (
  inventario_id   uuid PRIMARY KEY,
  company_id      uuid NOT NULL,
  numero          text,
  status          text,
  observacoes     text,
  total_produtos  integer,
  deleted_at_old  timestamptz,
  capturado_em    timestamptz NOT NULL DEFAULT now()
);
-- Tabela de backup é registro interno de operação: RLS ligada, sem policy permissiva, REVOKE anon (gate RLS).
ALTER TABLE public.erp_inventario_lixo_teste_bkp_c3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_inventario_lixo_teste_bkp_c3 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erp_inventario_lixo_teste_bkp_c3 TO service_role;

-- ── (2) Função de limpeza reutilizável: soft-delete do lixo de TESTE de inventário na DEMO ──
-- ci-sem-guarda: fn_demo_estoque_purgar_lixo_teste — função de DEMO: guarda por is_demo (nunca toca empresa real),
--                só service_role (REVOKE anon abaixo); não grava dado de empresa real, só soft-delete de lixo de teste.
CREATE OR REPLACE FUNCTION public.fn_demo_estoque_purgar_lixo_teste(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_inv int := 0;
BEGIN
  -- Só roda se a empresa existir E for DEMO (nunca toca empresa real nem ambiente sem a DEMO).
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.is_demo = true) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_ausente_ou_nao_demo');
  END IF;

  -- Conjunto-alvo: inventários VIVOS com assinatura de TESTE (E2E / teste de aceitação) E cancelados.
  -- Proteção explícita: inventário SEM marcador de teste nunca entra (seed legítimo futuro fica intacto).
  CREATE TEMP TABLE _inv_lixo_c3 ON COMMIT DROP AS
  SELECT i.id
    FROM public.erp_inventarios i
   WHERE i.company_id = p_company
     AND i.deleted_at IS NULL
     AND i.status = 'cancelado'
     AND (
          COALESCE(i.numero      ILIKE 'E2E%', false)
       OR COALESCE(i.observacoes ILIKE '%e2e%', false)
       OR COALESCE(i.observacoes ILIKE '%teste de aceita%', false)
     );

  -- Backup (idempotente) antes de alterar.
  INSERT INTO public.erp_inventario_lixo_teste_bkp_c3 (inventario_id, company_id, numero, status, observacoes, total_produtos, deleted_at_old)
  SELECT i.id, i.company_id, i.numero, i.status, i.observacoes, i.total_produtos, i.deleted_at
    FROM public.erp_inventarios i JOIN _inv_lixo_c3 l ON l.id = i.id
  ON CONFLICT (inventario_id) DO NOTHING;

  -- Soft-delete dos inventários de lixo (rastreável e reversível pelo backup).
  UPDATE public.erp_inventarios i
     SET deleted_at = now()
    FROM _inv_lixo_c3 l
   WHERE i.id = l.id
     AND i.deleted_at IS NULL;
  GET DIAGNOSTICS v_inv = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'company', p_company, 'inventarios_purgados', v_inv);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_demo_estoque_purgar_lixo_teste(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_estoque_purgar_lixo_teste(uuid) TO service_role;

-- ── Limpeza ÚNICA do estado atual de produção (DEMO "Comércio (GE)") ──
DO $once$
DECLARE r jsonb;
BEGIN
  SELECT public.fn_demo_estoque_purgar_lixo_teste('b0700000-0000-4000-a000-000000000004') INTO r;
  RAISE NOTICE 'Purga única DEMO GE inventário: %', r;
END $once$;

-- ── (3) Auto-cura a cada reset: CREATE OR REPLACE fn_demo_reset com UMA linha nova no bloco GE (004) ──
-- (verbatim de pg_get_functiondef de 22/11/2026 + chamada do purge de inventário ao lado da limpeza de cartões)
-- ci-sem-guarda: fn_demo_reset — função de DEMO: valida is_demo no início (RETURN erro se NOT is_demo), nunca
--                reseta/semeia/apaga empresa real; p_company_id é sempre uma DEMO. Escape já aplicado na origem
--                desta função; esta migration só acrescenta UMA chamada de limpeza de DEMO no bloco GE.
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb;
  v_gar jsonb; v_leads jsonb; v_com jsonb; v_fin jsonb; v_ban jsonb; v_fis jsonb; v_dre jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000005'::uuid THEN 'fn_gold_sst_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000006'::uuid THEN 'fn_demo_seed_construtora'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  -- conserto-main 14/11 (gilberto-esteira): a DEMO 005 apaga prod_setor no seed principal; o complemento de
  -- RH da rodada anterior (rh_pessoa_complemento.setor_id -> prod_setor, FK NO ACTION) bloqueia esse DELETE.
  -- Limpa o complemento FICTÍCIO da 005 ANTES dos seeds (fn_demo_seed_industria_rh_quadro o re-semeia no fim).
  -- is_demo já validado acima; dado 100% fake (RD-69/LGPD); nenhum cliente é tocado.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    DELETE FROM public.rh_pessoa_complemento WHERE company_id = p_company_id;
    -- conserto-main 21/11 (code-desenvolvedor-3 · #5748): MESMA FK, outra tabela. rh_vaga.setor_id -> prod_setor
    -- (rh_vaga_setor_id_fkey, ON DELETE RESTRICT) bloqueia o DELETE de prod_setor no seed principal (3 vagas
    -- FICTÍCIAS da 005 deixadas por fn_demo_seed_industria_rh_quadro). Limpa as vagas da 005 ANTES do seed; o
    -- re-seed do quadro as recria no fim (idempotente). Sem isso fn_demo_reset falha com 23503 e TODA a família
    -- SST da 005 fica vermelha.
    DELETE FROM public.rh_vaga WHERE company_id = p_company_id;
  END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid THEN
    v_com := fn_demo_seed_ge_comercial(p_company_id);
    v_fin := fn_demo_seed_ge_financeiro(p_company_id);
    v_ban := fn_demo_seed_ge_bancos(p_company_id);
    v_fis := fn_demo_seed_ge_fiscal(p_company_id);
    v_dre := fn_demo_seed_ge_dre(p_company_id);  -- [GE G0-F] Bloco 6: assinatura R$0 + DRE 6 meses
    -- 18/11 (code-desenvolvedor-3 · PDCA cartões, #5477): remove a poluição do e2e "CIELO ACEITE" na DEMO GE
    -- (adquirentes/taxas/repasses de teste), para a lista da tela de cartões não acumular entre rodadas.
    -- 22/11 (code-desenvolvedor-3 · PDCA inventário): mesma ideia para o lixo E2E de inventário (erp_inventarios),
    -- que crescia sem limite (~2.9k cancelados "E2E"), auto-curado a cada reset junto com os cartões.
    v_res := COALESCE(v_res, '{}'::jsonb)
      || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre)
      || jsonb_build_object('cartoes_limpeza', public.fn_demo_ge_limpar_cartoes_teste(p_company_id))
      || jsonb_build_object('estoque_limpeza', public.fn_demo_estoque_purgar_lixo_teste(p_company_id));
  END IF;

  -- 02/10: Pauta da P&M com cenário realista (atrasados, vence hoje, aguardando, rodadas)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta', public.fn_demo_seed_pm_pauta(p_company_id));
  END IF;

  -- 02/10 (PM-B): visões salvas da Pauta (link ?visao=)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_visoes', public.fn_demo_seed_pm_visoes(p_company_id));
  END IF;

  -- 02/10 (PM-C): rodadas, aprovações com prazo e motivos de espera da Pauta
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_fluxo', public.fn_demo_seed_pm_fluxo(p_company_id));
  END IF;

  -- 03/10 (Social): planejamento do mês de 2 clientes, posts e os jobs dos aprovados
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('social', public.fn_demo_seed_pm_social(p_company_id));
  END IF;

  -- 02/10 (PM-D): Meu dia — menções com @, anotações e horas de hoje
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_dia', public.fn_demo_seed_pm_dia(p_company_id));
  END IF;

  -- 31/10 (dev7claudeps · PDCA margem-job): serviço/valor/custo nos jobs + fees, para Margem por Serviço e por Fee
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('margem', public.fn_demo_seed_pm_margem(p_company_id));
  END IF;

  -- 07/11 (desenvolvedor_4_g · PDCA /dashboard/pm): a cada reset, reaplica a limpeza dos clientes de
  -- teste (E2E/[BOT]/teste/screenshot SEM job/contrato ativo) para o KPI "Clientes ativos" não voltar
  -- a inflar entre rodadas de E2E. Idempotente e travado em empresa is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('limpeza_clientes_teste', public.fn_demo_pm_limpar_clientes_teste(p_company_id));
  END IF;

  -- 01/11 (PDCA Hub · simulador): simulações salvas reais da construtora DEMO (bloco "Simulações salvas" não fica vazio)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  -- 08/11 (dev7claudeps · RH/Postos genérico, CEO 08/11): quadro de postos do abatedouro FICTÍCIO da DEMO de
  -- indústria (setor → posto → pessoa com CPF manual + custo por posto; postos vazios = vagas). RD-69: tudo FAKE.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
  END IF;

  -- 16/11 (code-desenvolvedor-3 · EHS S1 piloto, re-seed RECONCILIADO pós-reversão do #5174): matrizes de
  -- risco (S1.1), EPI (S1.2) e treino (S1.3) por setor/posto, DURÁVEIS a cada reset (os seeds das migrations
  -- são one-shot e o reset os apagava). RECONCILIADO com o caminho protegido SST·LTCAT: a função NÃO semeia
  -- RISCO na Desossa (Desossa começa vazia, como o teste exige); EPI e treino seguem em todos. Roda DEPOIS
  -- dos postos (precisa dos postos/setores). RD-69: tudo FAKE; trava is_demo na função.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_matrizes', public.fn_demo_seed_ehs_matrizes(p_company_id));
  END IF;

  -- 12/11 (desenvolvedor_4_g · PDCA aud8 Controle de frota, DEMO 005): frota FICTÍCIA (veículos + planos de
  -- manutenção + documentos + custos + viagens/abastecimento) para os 6 KPIs da tela de frota deixarem de
  -- ficar zerados e a jornada de inclusão/edição/custo ser verificável. RD-69: tudo FAKE. Idempotente e is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('frota', public.fn_demo_seed_industria_frota(p_company_id));
  END IF;

  -- 19/11 (desenvolvedor_4_g · PDCA aud8 Quadro de pessoal, DEMO 005): re-semeia o complemento de RH (cargo,
  -- setor, supervisor, salário-base), a jornada/escala e as VAGAS por colaborador do ponto, que o reset APAGA no
  -- início (conserto-main 14/11 + 21/11) mas deixou de re-semear. Roda por ÚLTIMO no bloco da 005 — depois de
  -- postos recriar prod_setor/prod_cargo que o re-seed referencia por nome. Sem isso Supervisor/Escala/Carga/
  -- Salário ficam "—" na tela /dashboard/industrial/rh/quadro e as 3 vagas somem. Idempotente e is_demo (RD-69).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

-- Guarda de acesso da função de reset (idempotente; só service_role a executa, como já estava).
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO service_role;
