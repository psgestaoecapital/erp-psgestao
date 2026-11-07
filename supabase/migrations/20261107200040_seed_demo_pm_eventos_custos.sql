-- PDCA P&M · /dashboard/pm/eventos · Previsto × Realizado sem dado (aud8 95/95 bloqueado)
-- Gap (auditor_pdca_2, RD-38): a Agência (P&M) - DEMO (b0700000-...-0002) tem ZERO contas a pagar,
-- então fn_pm_evento_pagar_disponiveis devolve vazio (CTA "+ Vincular custo" sem saída) e a coluna
-- "Realizado" mostra "—" em todos os eventos. A jornada Previsto × Realizado não é exercitável.
--
-- Decisão de escopo (documentada): o realizado vem do erp_pagar da PRÓPRIA empresa da agência —
-- é o que fn_pm_eventos_resultado e fn_pm_evento_pagar_disponiveis filtram (company_id do evento)
-- e o que o estado-vazio da tela orienta ("Lance a despesa em Contas a pagar da empresa"). NÃO há
-- bug de escopo: semeamos os pagáveis na própria agência DEMO. Aditivo, idempotente, SÓ demo.
--
-- Semeia 5 contas a pagar reais de fornecedor de evento e PRÉ-VINCULA 3 ao evento "Lançamento de
-- produto" (realizado): realizado = 15.300 de 22.000 previstos (pct 69,5%, saldo 6.700). Deixa 2
-- pagáveis SEM vínculo para o seletor "+ Vincular custo" não ficar vazio.
-- Nunca toca dado de cliente nem empresa não-demo.

-- 1) Função de seed idempotente (demo-only)
CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_eventos_custos(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean;
  v_evt uuid;
  v_ins int := 0;
  v_vinc int := 0;
  v_base date := current_date - 20;  -- data do evento "Lançamento de produto" no seed de eventos
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo INTO v_is_demo FROM public.companies c WHERE c.id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo'); END IF;

  -- 5 contas a pagar de fornecedores de evento (idempotente por company_id + descricao)
  INSERT INTO public.erp_pagar
    (company_id, descricao, fornecedor_nome, categoria, linha_negocio, valor, valor_pago,
     data_emissao, data_vencimento, data_pagamento, status, observacoes)
  SELECT p_company_id, d.descricao, d.fornecedor, d.categoria, 'pm_eventos', d.valor,
         CASE WHEN d.status='pago' THEN d.valor ELSE 0 END,
         v_base - 7, d.venc, CASE WHEN d.status='pago' THEN d.pagto END, d.status,
         'seed_demo:pm_eventos_custos'
  FROM (VALUES
    ('Locação do espaço — Lançamento de produto',            'Rooftop Eventos Ltda',       'Locação',     7000::numeric, (v_base - 2), (v_base - 2), 'pago'),
    ('Buffet e coffee break — Lançamento de produto',        'Sabor & Cia Buffet',         'Alimentação', 4500::numeric, (v_base - 1), (v_base - 1), 'pago'),
    ('Equipe freelancer de produção — Lançamento de produto','Coletivo de Produção',       'Equipe',      3800::numeric, (v_base + 5), NULL::date,  'aberto'),
    ('Mídia e tráfego pago — Lançamento de produto',         'Performance Mídia Digital',  'Mídia',       2900::numeric, (v_base + 10), NULL::date, 'aberto'),
    ('Locação de equipamento de filmagem — Gravação institucional', 'Cine Rental Equipamentos', 'Locação', 3200::numeric, (current_date + 10), NULL::date, 'aberto')
  ) AS d(descricao, fornecedor, categoria, valor, venc, pagto, status)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.erp_pagar p
     WHERE p.company_id = p_company_id AND p.descricao = d.descricao AND p.deleted_at IS NULL
  );
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- Vincula os 3 custos do "Lançamento de produto" (realizado) ao evento, idempotente
  SELECT e.id INTO v_evt
    FROM public.agency_eventos e
   WHERE e.company_id = p_company_id AND e.nome = 'Lançamento de produto' AND e.excluido_em IS NULL
   LIMIT 1;

  IF v_evt IS NOT NULL THEN
    INSERT INTO public.agency_evento_pagar (company_id, evento_id, lancamento_id)
    SELECT p_company_id, v_evt, p.id
      FROM public.erp_pagar p
     WHERE p.company_id = p_company_id
       AND p.deleted_at IS NULL
       AND p.descricao IN (
         'Locação do espaço — Lançamento de produto',
         'Buffet e coffee break — Lançamento de produto',
         'Equipe freelancer de produção — Lançamento de produto'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.agency_evento_pagar v WHERE v.lancamento_id = p.id
       );
    GET DIAGNOSTICS v_vinc = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'evento_lancamento', v_evt,
    'pagaveis_inseridos', v_ins,
    'vinculos_criados', v_vinc
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_eventos_custos(uuid) FROM PUBLIC, anon;

-- 2) Liga o seed ao reset da DEMO da P&M (sobrevive ao fn_demo_reset)
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
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre);
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

  -- 07/11 (PDCA eventos · Previsto × Realizado): contas a pagar de fornecedor de evento + vínculos
  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('eventos_custos', public.fn_demo_seed_pm_eventos_custos(p_company_id));
  END IF;

  -- 01/11 (PDCA Hub · simulador): simulações salvas reais da construtora DEMO (bloco "Simulações salvas" não fica vazio)
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

-- 3) Carga inicial na DEMO existente (produção + banco de testes); idempotente
DO $$
DECLARE v_comp uuid;
BEGIN
  SELECT c.id INTO v_comp FROM public.companies c
   WHERE c.is_demo = true AND EXISTS (SELECT 1 FROM public.agency_jobs j WHERE j.company_id = c.id)
   ORDER BY c.id LIMIT 1;
  IF v_comp IS NOT NULL THEN
    PERFORM public.fn_demo_seed_pm_eventos_custos(v_comp);
  END IF;
END $$;
