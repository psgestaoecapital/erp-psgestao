-- PDCA Hub › Financeiro › Permutas (auditor_pdca_2 13/11, DEMO Construtora b07…0006) — GAP 4:
-- a jornada "Permutas" (conta-corrente de imóvel) passa em RD-95/menu/origem, mas a DEMO não tinha
-- NENHUMA permuta, então o aud8 não conseguia re-pontuar a jornada (tela viva mas sem dado).
-- Entrega: seed idempotente de 3 permutas na DEMO Construtora, com reajuste CUB e movimentos
-- (material/serviço/imóvel), cobrindo os 3 estados visíveis da tela (a_iniciar, em_andamento,
-- quitado). Integrado ao fn_demo_reset para SOBREVIVER ao reset da DEMO (igual aos demais seeds).
-- Aditivo · só DEMO (is_demo, guardado) · nenhum dado de cliente real tocado · sem cron novo (RD-101).

-- ── Seed idempotente das permutas da DEMO Construtora ────────────────────────────────────────────────
-- ci-sem-guarda: fn_demo_seed_construtora_permutas — seed DEMO; confere is_demo (companies.is_demo) antes de gravar e aborta em empresa real; sem auth.uid(). Não toca dado de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_construtora_permutas(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean;
  v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_obra uuid;
BEGIN
  SELECT is_demo INTO v_is_demo FROM public.companies WHERE id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- Idempotência: remove as permutas DEMO desta empresa (cascade apaga movimentos/reajustes) e recria.
  DELETE FROM public.hub_permuta WHERE company_id = p_company_id;

  -- Obra opcional (link solto): usa a 1ª obra da construtora se existir; senão NULL (coluna NULLable).
  SELECT id INTO v_obra FROM public.projetos_obras
   WHERE company_id = p_company_id ORDER BY created_at NULLS LAST LIMIT 1;

  -- ── Permuta 1: EM ANDAMENTO (parcialmente quitada por material + serviço) ──────────────────────────
  INSERT INTO public.hub_permuta (company_id, obra_id, contratante, ativo_descr, tipo_contrato,
    pct_permuta, valor_permuta, valor_dinheiro, indice_reajuste, data_base, status, intragrupo)
  VALUES (p_company_id, v_obra, 'Terreno Família Andrade', 'Apto 1202 Torre Amazon', 'misto',
    70, 420000, 80000, 'CUB-SC', DATE '2026-01-10', 'em_andamento', false)
  RETURNING id INTO v_p1;
  INSERT INTO public.hub_permuta_reajuste (permuta_id, company_id, competencia, indice_valor, valor_reajuste) VALUES
    (v_p1, p_company_id, DATE '2026-02-01', 2456.10, 1800),
    (v_p1, p_company_id, DATE '2026-03-01', 2480.80, 1850),
    (v_p1, p_company_id, DATE '2026-04-01', 2506.20, 1900);
  INSERT INTO public.hub_permuta_movimento (permuta_id, company_id, tipo, competencia, valor, data, num_nota, obs) VALUES
    (v_p1, p_company_id, 'material', DATE '2026-03-01', 150000, DATE '2026-03-18', 'NF 10234', 'Estrutura e alvenaria'),
    (v_p1, p_company_id, 'servico',  DATE '2026-04-01', 120000, DATE '2026-04-22', 'MED 07',   'Medição de mão de obra');

  -- ── Permuta 2: QUITADA (material + imóvel fecham o valor atualizado) ───────────────────────────────
  INSERT INTO public.hub_permuta (company_id, obra_id, contratante, ativo_descr, tipo_contrato,
    pct_permuta, valor_permuta, valor_dinheiro, indice_reajuste, data_base, status, intragrupo)
  VALUES (p_company_id, v_obra, 'Incorporadora Cedro', 'Casa 07 Residencial Cedro', '100_permuta',
    100, 300000, 0, 'CUB-SC', DATE '2025-11-05', 'quitado', false)
  RETURNING id INTO v_p2;
  INSERT INTO public.hub_permuta_reajuste (permuta_id, company_id, competencia, indice_valor, valor_reajuste) VALUES
    (v_p2, p_company_id, DATE '2025-12-01', 2410.00, 1200),
    (v_p2, p_company_id, DATE '2026-01-01', 2432.00, 1250);
  INSERT INTO public.hub_permuta_movimento (permuta_id, company_id, tipo, competencia, valor, data, num_nota, obs) VALUES
    (v_p2, p_company_id, 'material', DATE '2025-12-01', 180000, DATE '2025-12-20', 'NF 9980', 'Material de acabamento'),
    (v_p2, p_company_id, 'imovel',   DATE '2026-02-01', 122450, DATE '2026-02-15', NULL,      'Dação de sala comercial');

  -- ── Permuta 3: A INICIAR (sem movimento ainda) ─────────────────────────────────────────────────────
  INSERT INTO public.hub_permuta (company_id, obra_id, contratante, ativo_descr, tipo_contrato,
    pct_permuta, valor_permuta, valor_dinheiro, indice_reajuste, data_base, status, intragrupo)
  VALUES (p_company_id, v_obra, 'Construtora Horizonte', 'Sala Comercial 310 Edifício Vértice', 'misto',
    60, 180000, 40000, 'CUB-SC', DATE '2026-05-02', 'a_iniciar', false)
  RETURNING id INTO v_p3;

  RETURN jsonb_build_object('ok', true, 'permutas', 3,
    'ids', jsonb_build_array(v_p1, v_p2, v_p3), 'obra', v_obra);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora_permutas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora_permutas(uuid) TO authenticated, service_role;

-- ── Integra ao fn_demo_reset (sobrevive ao reset) — CREATE OR REPLACE da versão viva + 1 bloco novo ──
-- (reproduz a definição viva; única mudança: o bloco 'permutas' após 'simulacoes' para a Construtora.)
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
