-- Indústria · RH/Postos GENÉRICO (desenho do CEO 08/11; decisão do Eng. Chefe: estender /dashboard/produtividade).
-- Code: dev7claudeps · tarefa beebd8a4.
--
-- GAP (RD-26/RD-38): a empresa DEMO de indústria (b0700000-...-005, "Indústria (SST) - DEMO") tinha 2 setores
-- (Abate, Desossa) e ZERO postos/pessoas/custo. A tela /dashboard/produtividade (quadro de postos: fluxo →
-- setor → posto → pessoa + CPF + custo, vagas = posto sem pessoa) aparecia vazia na DEMO, impedindo o auditor
-- e o usuário de ver o módulo funcionando ponta a ponta.
--
-- ESTA MIGRATION (aditiva, RD-69): semeia um QUADRO DE POSTOS FICTÍCIO de abatedouro para a DEMO — setores já
-- existentes → postos seguindo o fluxo do abate/desossa → pessoa (CPF MANUAL, sem vínculo a funcionário real) →
-- custo por posto. Nomes, CPFs e salários são 100% FAKE. NUNCA toca dado de cliente real; trava em is_demo e na
-- empresa 005. Alguns postos ficam SEM pessoa de propósito (vaga aberta), para a tela mostrar "vaga × ocupado".
--
-- IDEMPOTENTE e reset-safe: o seed vira uma função própria chamada por fn_demo_reset (mesmo padrão dos seeds
-- extras da revenda/GE 003/004). A fn_gold_sst_seed_reparar já zera prod_posto/pessoa antes; a função re-zera os
-- próprios dados da DEMO ao rodar isolada.

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1) Seed do quadro de postos da DEMO de indústria (abatedouro fictício)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_seed_industria_postos(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c        constant uuid := 'b0700000-0000-4000-a000-000000000005';
  v_planta uuid;
  v_abate  uuid;
  v_desossa uuid;
  v_setor  uuid;
  v_posto  uuid;
  v_i      int := 0;
  v_cpf    text;
  r        record;
BEGIN
  -- trava: só a DEMO de indústria
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_industria');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- delete físico liberado SÓ nesta transação e SÓ nas linhas da demo (RD-30: manutenção deliberada)
  PERFORM set_config('app.permitir_delete_fisico', 'on', true);

  SELECT id INTO v_planta FROM industrial_plants WHERE company_id = c AND codigo_planta = 'DEMO-SST';
  IF v_planta IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'planta_demo_ausente');
  END IF;

  -- os setores são recriados a cada reset (ids novos): procura por nome
  SELECT id INTO v_abate   FROM prod_setor WHERE company_id = c AND nome = 'Abate'   ORDER BY ordem LIMIT 1;
  SELECT id INTO v_desossa FROM prod_setor WHERE company_id = c AND nome = 'Desossa' ORDER BY ordem LIMIT 1;
  IF v_abate IS NULL OR v_desossa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setores_demo_ausentes');
  END IF;

  -- idempotência: zera só os postos/custos/pessoas desta DEMO
  DELETE FROM prod_posto_custo  WHERE company_id = c;
  DELETE FROM prod_posto_pessoa WHERE company_id = c;
  DELETE FROM prod_posto_turno  WHERE company_id = c;
  DELETE FROM prod_posto        WHERE company_id = c;

  -- catálogo de postos: fluxo do abate → desossa. ocupa=false ⇒ vaga aberta (sem pessoa).
  -- (setor_tag, numero, atividade, ordem, ocupa, nome, salario, encargos_pct)
  FOR r IN
    SELECT * FROM (VALUES
      -- Abate (fluxo da nave de abate)
      ('A','01','Insensibilização',          1, true,  'Bruno Carvalho Demo',  3200, 68),
      ('A','02','Sangria',                    2, true,  'Diego Rocha Demo',     3000, 68),
      ('A','03','Esfola',                     3, true,  'Fábio Lima Demo',      3100, 68),
      ('A','04','Evisceração',                4, true,  'Hugo Martins Demo',    3100, 68),
      ('A','05','Inspeção oficial (SIF)',     5, false, NULL,                   3600, 68),
      ('A','06','Tipificação e pesagem',      6, true,  'João Pedro Demo',      3400, 68),
      -- Desossa (sala de desossa / embalagem)
      ('D','01','Quarteamento',               1, true,  'Lucas Ferreira Demo',  2900, 68),
      ('D','02','Desossa do dianteiro',       2, true,  'Nelson Pires Demo',    2950, 68),
      ('D','03','Desossa do traseiro',        3, false, NULL,                   2950, 68),
      ('D','04','Embalagem a vácuo',          4, true,  'Paulo Teixeira Demo',  2700, 68),
      ('D','05','Expedição',                  5, false, NULL,                   2800, 68)
    ) AS t(setor_tag, numero, atividade, ordem, ocupa, nome, salario, encargos)
  LOOP
    v_setor := CASE r.setor_tag WHEN 'A' THEN v_abate ELSE v_desossa END;

    INSERT INTO prod_posto (company_id, plant_id, setor_id, numero, atividade, ordem_linha, alocacao, ativo)
    VALUES (c, v_planta, v_setor, r.numero, r.atividade, r.ordem, 'fixa', true)
    RETURNING id INTO v_posto;

    -- custo do posto (salário FAKE + encargos). Base do custo de produção por posto na tela.
    INSERT INTO prod_posto_custo (company_id, plant_id, posto_id, vigencia_inicio, mao_obra_mes, encargos_pct)
    VALUES (c, v_planta, v_posto, current_date, r.salario, r.encargos);

    -- pessoa com CPF MANUAL (sem funcionário real): demonstra o caso "RH preenche na tela".
    IF r.ocupa THEN
      v_i := v_i + 1;
      v_cpf := fn_demo_cpf_valido(556000000 + v_i);
      INSERT INTO prod_posto_pessoa (company_id, plant_id, posto_id, funcionario_id, cpf, vigencia_inicio)
      VALUES (c, v_planta, v_posto, NULL, v_cpf, current_date);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'bloco', 'industria_postos',
    'postos',        (SELECT count(*) FROM prod_posto WHERE company_id = c),
    'ocupados',      (SELECT count(*) FROM prod_posto p WHERE p.company_id = c
                        AND EXISTS (SELECT 1 FROM prod_posto_pessoa pp WHERE pp.posto_id = p.id)),
    'vagas_abertas', (SELECT count(*) FROM prod_posto p WHERE p.company_id = c
                        AND NOT EXISTS (SELECT 1 FROM prod_posto_pessoa pp WHERE pp.posto_id = p.id)),
    'pessoas',       (SELECT count(*) FROM prod_posto_pessoa WHERE company_id = c),
    'custos',        (SELECT count(*) FROM prod_posto_custo WHERE company_id = c));
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_industria_postos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_industria_postos(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2) fn_demo_reset: acrescenta o braço 005 (postos do abatedouro) — reproduz a versão VIVA e só ADICIONA o bloco.
--    (lida via pg_get_functiondef antes de reescrever — RD-26/RD-38.)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3) Primeira carga: repõe a DEMO de indústria já com o quadro de postos.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
SELECT public.fn_demo_reset('b0700000-0000-4000-a000-000000000005');
