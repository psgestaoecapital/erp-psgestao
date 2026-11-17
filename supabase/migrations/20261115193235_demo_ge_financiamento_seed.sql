-- PDCA GE (auditor_pdca_2 13/11) — /dashboard/gestao-empresarial/financiamento (aud8 82/95, "dado não
-- bate com banco"). A TELA é real e madura, mas a DEMO Comércio GE (b07…0004) estava SEM SEED:
-- financiamentos=0 e financiamento_parcelas=0 → KPIs/cronograma em zero (daí a nota presa e o "não bate").
-- Entrega: seed idempotente de 2 financiamentos (PRICE + SAC) com cronograma e KPIs consistentes,
-- integrado ao fn_demo_reset (sobrevive ao reset). Aditivo · só DEMO · nenhum dado de cliente real.
--
-- A geração do cronograma e o recálculo dos derivados REPLICAM fielmente a lógica viva de
-- fn_financiamento_gerar_cronograma + fn_financiamento_recalcular (ramo "cronograma manda", CEO 25/06),
-- removendo apenas a guarda de usuário (get_user_company_ids) — o seed roda como conexão de serviço, sem
-- auth.uid(); a guarda real das RPCs de usuário permanece intacta.

-- ── Helper service-only: gera cronograma + recalcula derivados de UM financiamento (DEMO) ────────────
-- ci-sem-guarda: fn__demo_financiamento_cronograma — helper service-only de seed DEMO; roda como service_role sem auth.uid() e grava apenas em empresa is_demo (o seed já conferiu is_demo antes de chamar). Não há dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn__demo_financiamento_cronograma(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f RECORD;
  v_i numeric; v_n int; v_pv numeric; v_parcela numeric;
  v_saldo numeric; v_juros numeric; v_amort numeric; v_amort_sac numeric;
  v_venc date; v_base date; k int; v_status text; v_sac boolean;
  v_pagas int; v_restantes int; v_saldo_principal numeric; v_saldo_parcelas numeric;
  v_amortizado numeric; v_juros_pagos numeric; v_parcela_atual numeric;
BEGIN
  SELECT * INTO f FROM financiamentos WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_i  := COALESCE(f.taxa_mensal,0)/100.0;
  v_n  := COALESCE(f.parcelas,0);
  v_pv := COALESCE(NULLIF(f.valor_liquido,0), f.valor_original, 0);
  IF v_n <= 0 OR v_pv <= 0 THEN RETURN; END IF;

  v_sac  := UPPER(COALESCE(f.sistema_amortizacao,'PRICE')) = 'SAC';
  v_base := COALESCE(f.data_primeira_parcela, f.data_liberacao, CURRENT_DATE);

  DELETE FROM financiamento_parcelas WHERE financiamento_id = p_id;  -- idempotente

  v_saldo := v_pv;
  IF NOT v_sac AND v_i > 0 THEN
    v_parcela := round(v_pv * v_i * power(1+v_i,v_n)/(power(1+v_i,v_n)-1), 2);  -- PRICE
  ELSIF v_sac THEN
    v_amort_sac := round(v_pv / v_n, 2);                                        -- SAC
  ELSE
    v_parcela := round(v_pv / v_n, 2);                                          -- sem juros
  END IF;

  FOR k IN 1..v_n LOOP
    v_venc := (v_base + ((k-1) || ' months')::interval)::date;
    IF v_sac THEN
      v_amort   := v_amort_sac;
      v_juros   := round(v_saldo * v_i, 2);
      v_parcela := round(v_amort + v_juros, 2);
    ELSIF v_i > 0 THEN
      v_juros := round(v_saldo * v_i, 2);
      v_amort := round(v_parcela - v_juros, 2);
    ELSE
      v_juros := 0; v_amort := v_parcela;
    END IF;
    v_saldo := round(v_saldo - v_amort, 2);
    IF k = v_n THEN v_saldo := 0; END IF;
    v_status := CASE WHEN k <= COALESCE(f.parcelas_pagas,0) THEN 'paga' ELSE 'aberta' END;

    INSERT INTO financiamento_parcelas
      (financiamento_id, company_id, numero, data_vencimento, valor_parcela,
       amortizacao, juros, saldo_apos, status, tipo, desconto_adimplencia,
       data_pagamento, valor_pago)
    VALUES
      (p_id, f.company_id, k, v_venc, v_parcela, v_amort, v_juros,
       GREATEST(v_saldo,0), v_status, 'amortizacao', 0,
       CASE WHEN k <= COALESCE(f.parcelas_pagas,0) THEN v_venc ELSE NULL END,
       CASE WHEN k <= COALESCE(f.parcelas_pagas,0) THEN v_parcela ELSE NULL END);
  END LOOP;

  -- Recalcula derivados do cabeçalho a partir do cronograma (ramo "cronograma manda").
  SELECT
    count(*) FILTER (WHERE status IN ('paga','pago')),
    count(*) FILTER (WHERE status NOT IN ('paga','pago')),
    round(COALESCE(sum(amortizacao) FILTER (WHERE status NOT IN ('paga','pago')),0),2),
    round(COALESCE(sum(valor_parcela) FILTER (WHERE status NOT IN ('paga','pago')),0),2),
    round(COALESCE(sum(amortizacao) FILTER (WHERE status IN ('paga','pago')),0),2),
    round(COALESCE(sum(juros) FILTER (WHERE status IN ('paga','pago')),0),2)
  INTO v_pagas, v_restantes, v_saldo_principal, v_saldo_parcelas, v_amortizado, v_juros_pagos
  FROM financiamento_parcelas WHERE financiamento_id = p_id;

  SELECT valor_parcela INTO v_parcela_atual FROM financiamento_parcelas
    WHERE financiamento_id = p_id AND status NOT IN ('paga','pago') ORDER BY numero LIMIT 1;

  UPDATE financiamentos SET
    parcelas_pagas       = v_pagas,
    parcelas_restantes   = v_restantes,
    saldo_devedor        = v_saldo_principal,
    saldo_total_parcelas = v_saldo_parcelas,
    valor_amortizado     = v_amortizado,
    juros_pagos          = v_juros_pagos,
    valor_parcela        = COALESCE(v_parcela_atual, valor_parcela, 0)
  WHERE id = p_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn__demo_financiamento_cronograma(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__demo_financiamento_cronograma(uuid) TO service_role;

-- ── Seed idempotente dos financiamentos da DEMO Comércio GE ──────────────────────────────────────────
-- ci-sem-guarda: fn_demo_seed_ge_financiamento — seed DEMO; confere is_demo (companies.is_demo) antes de gravar e retorna 'nao_e_demo' em empresa real; sem auth.uid(). Não toca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ge_financiamento(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_f1 uuid; v_f2 uuid;
BEGIN
  SELECT is_demo INTO v_is_demo FROM public.companies WHERE id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo'); END IF;

  -- Idempotência: remove os financiamentos DEMO (cascade apaga as parcelas) e recria.
  DELETE FROM public.financiamento_parcelas
    WHERE financiamento_id IN (SELECT id FROM public.financiamentos WHERE company_id = p_company_id);
  DELETE FROM public.financiamentos WHERE company_id = p_company_id;

  -- Financiamento 1 — Capital de giro (PRICE), 6 de 24 parcelas pagas.
  INSERT INTO public.financiamentos
    (company_id, banco, instituicao, tipo, tipo_operacao, modalidade, fonte_verificacao,
     finalidade, sistema_amortizacao, valor_original, valor_liquido, taxa_mensal, taxa_anual,
     parcelas, parcelas_pagas, periodicidade, data_liberacao, data_primeira_parcela, dia_vencimento,
     status, situacao, contrato)
  VALUES
    (p_company_id, 'Banco do Brasil', 'Banco do Brasil', 'Empréstimo', 'financiamento', 'capital_giro', 'seed_demo',
     'Capital de giro', 'PRICE', 200000, 200000, 1.50, 19.56,
     24, 6, 'mensal', DATE '2026-04-10', DATE '2026-05-10', 10,
     'ativo', 'Normal', 'CTR-2026-0001')
  RETURNING id INTO v_f1;
  PERFORM public.fn__demo_financiamento_cronograma(v_f1);

  -- Financiamento 2 — Aquisição de equipamento (SAC), 3 de 36 parcelas pagas.
  INSERT INTO public.financiamentos
    (company_id, banco, instituicao, tipo, tipo_operacao, modalidade, fonte_verificacao,
     finalidade, sistema_amortizacao, valor_original, valor_liquido, taxa_mensal, taxa_anual,
     parcelas, parcelas_pagas, periodicidade, data_liberacao, data_primeira_parcela, dia_vencimento,
     status, situacao, contrato)
  VALUES
    (p_company_id, 'Caixa Econômica', 'Caixa Econômica', 'Financiamento', 'financiamento', 'investimento', 'seed_demo',
     'Aquisição de equipamento', 'SAC', 120000, 120000, 1.20, 15.39,
     36, 3, 'mensal', DATE '2026-07-05', DATE '2026-08-05', 5,
     'ativo', 'Normal', 'CTR-2026-0002')
  RETURNING id INTO v_f2;
  PERFORM public.fn__demo_financiamento_cronograma(v_f2);

  RETURN jsonb_build_object('ok', true, 'financiamentos', 2, 'ids', jsonb_build_array(v_f1, v_f2));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_demo_seed_ge_financiamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ge_financiamento(uuid) TO authenticated, service_role;

-- ── Integra ao fn_demo_reset (sobrevive ao reset) — bloco novo para a DEMO Comércio GE (b07…0004) ────
-- (reproduz a definição viva; única mudança: +bloco 'financiamento' logo após o bloco de GE existente.)
-- ci-sem-guarda: fn_demo_reset — reset de empresa DEMO; confere is_demo e aborta ('nao_e_demo') em empresa real; só repopula seeds de demonstração, nunca dado de cliente real.
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

  -- 13/11 (gilberto-esteira · conserto-main): limpar o complemento de RH da DEMO 005 ANTES do seed principal
  -- (fn_gold_sst_seed_reparar apaga prod_setor; complementos da rodada anterior bloqueavam via FK 23503).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    DELETE FROM public.rh_pessoa_complemento WHERE company_id = p_company_id;
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
    v_dre := fn_demo_seed_ge_dre(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre);
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta', public.fn_demo_seed_pm_pauta(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_visoes', public.fn_demo_seed_pm_visoes(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_fluxo', public.fn_demo_seed_pm_fluxo(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('social', public.fn_demo_seed_pm_social(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('pauta_dia', public.fn_demo_seed_pm_dia(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('margem', public.fn_demo_seed_pm_margem(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000002'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('limpeza_clientes_teste', public.fn_demo_pm_limpar_clientes_teste(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('simulacoes', public.fn_demo_seed_construtora_simulacoes(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('postos', public.fn_demo_seed_industria_postos(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- Seeds PDCA 13/11 — chamadas GUARDADAS (merge-order-safe entre PRs que tocam fn_demo_reset):
  -- cada seed só roda se a função já existe no banco (to_regprocedure); assim, publicar as PRs em
  -- qualquer ordem NUNCA remove o bloco da outra nem erra chamando função ainda não publicada.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000006'::uuid
     AND to_regprocedure('public.fn_demo_seed_construtora_permutas(uuid)') IS NOT NULL THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('permutas', public.fn_demo_seed_construtora_permutas(p_company_id));
  END IF;

  IF p_company_id = 'b0700000-0000-4000-a000-000000000004'::uuid
     AND to_regprocedure('public.fn_demo_seed_ge_financiamento(uuid)') IS NOT NULL THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('financiamento', public.fn_demo_seed_ge_financiamento(p_company_id));
  END IF;

  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;
-- Reafirma as permissões vivas de fn_demo_reset (CREATE OR REPLACE não altera grants; linhas idempotentes p/ o gate check-fn-guards).
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;
