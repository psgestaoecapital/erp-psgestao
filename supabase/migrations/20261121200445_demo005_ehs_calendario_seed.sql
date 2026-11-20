-- PDCA auditor · /dashboard/ehs/calendario (DEMO indústria 005) · desenvolvedor_4_g 20/11/2026
-- ============================================================================
-- GAP do auditor: "DEMO sem tarefas geradas — KPIs 0/R$0,00 e lista vazia; a vitrine não demonstra
--   o Calendário Legal". (O gap de RD-95 "?" já foi entregue na #5650.)
-- CAUSA-RAIZ (RD-38, provado no banco de produção): o seed principal da 005 (fn_gold_sst_seed_reparar)
--   semeia 67 compliance_documentos (com vencidos/vencendo) e APAGA compliance_calendar_tarefas no início,
--   mas NUNCA chama os geradores do calendário — então a tela /ehs/calendario abre vazia (0 tarefas).
--   As funções fn_compliance_calendar_gerar_de_documentos(company,90) e
--   fn_compliance_calendar_gerar_recorrentes_mensais(company,NULL) já existem e, rodadas sobre os docs
--   da DEMO 005, produzem 20 tarefas (provado em transação BEGIN…ROLLBACK).
-- CORREÇÃO (aditiva, durável, idempotente): nova fn_demo_seed_ehs_calendario(005) chama os dois geradores
--   DEPOIS do seed principal (que cria os documentos-fonte) e é encaixada no fim do bloco da 005 do
--   fn_demo_reset — persiste a cada reset, como os demais complementos (rh_quadro, frota, ehs_matrizes).
--   Idempotente: só gera se o calendário estiver vazio (o reset o esvazia no seed principal). Travada em
--   is_demo + company 005 (RD-69/LGPD: dado 100% fictício; nenhum cliente é tocado). Não cria/altera
--   tabela nem RLS; só semeia dado FAKE na DEMO.
-- O corpo de fn_demo_reset é idêntico ao vivo (migration 20261121160040), só com o bloco novo adicionado.
-- ============================================================================

-- ── novo complemento: gera o calendário legal da DEMO 005 a partir dos documentos já semeados ──
-- ci-sem-guarda: fn_demo_seed_ehs_calendario — seed da DEMO; só service_role; trava por is_demo=true + company 005; dado 100% fictício da própria empresa DEMO.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ehs_calendario(p_company_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c constant uuid := 'b0700000-0000-4000-a000-000000000005';
  v_qtd int;
BEGIN
  IF p_company_id IS DISTINCT FROM c THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_005');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = c AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- idempotente: o seed principal (fn_gold_sst_seed_reparar) zera o calendário no início do reset; só
  -- gera quando está vazio, para uma reexecução avulsa não duplicar as tarefas.
  SELECT count(*) INTO v_qtd FROM public.compliance_calendar_tarefas WHERE company_id = c;
  IF v_qtd = 0 THEN
    PERFORM public.fn_compliance_calendar_gerar_de_documentos(c, 90);
    PERFORM public.fn_compliance_calendar_gerar_recorrentes_mensais(c, NULL);
  END IF;

  SELECT count(*) INTO v_qtd FROM public.compliance_calendar_tarefas WHERE company_id = c;
  RETURN jsonb_build_object('ok', true, 'bloco', 'ehs_calendario', 'tarefas', v_qtd);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ehs_calendario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ehs_calendario(uuid) TO authenticated, service_role;

-- ── fn_demo_reset: encaixa o complemento do calendário no fim do bloco da 005 ──
-- ci-sem-guarda: fn_demo_reset — reset da DEMO; só service_role; trava por is_demo=true + company_id (bloco guardado), não por membership de usuário (sem auth.uid no fluxo de reset). Todas as escritas operam sobre dado 100% fictício da própria empresa DEMO já validada.
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
  -- setor, supervisor, salário-base) e a jornada/escala por colaborador do ponto, que o reset APAGA no início
  -- (conserto-main 14/11) mas deixou de re-semear. Roda por ÚLTIMO no bloco da 005 — depois de postos recriar
  -- prod_setor/prod_cargo que o re-seed referencia por nome. Sem isso Supervisor/Escala/Carga/Salário ficam "—"
  -- na tela /dashboard/industrial/rh/quadro. Idempotente e travado em is_demo (RD-69: dado 100% fictício).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('rh_quadro', public.fn_demo_seed_industria_rh_quadro(p_company_id));
  END IF;

  -- 20/11 (desenvolvedor_4_g · PDCA auditor /dashboard/ehs/calendario, DEMO 005): gera o Calendário Legal a
  -- partir dos documentos de compliance já semeados (fn_gold_sst_seed_reparar) + recorrentes do mês. Sem isso
  -- a tela abre com KPIs 0 e lista vazia (não demonstra o calendário). Roda DEPOIS do seed principal (fonte dos
  -- documentos). Idempotente (só gera se vazio) e travado em is_demo (RD-69: dado 100% fictício).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_calendario', public.fn_demo_seed_ehs_calendario(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

-- Guarda de função (RD-30 / check-fn-guards): fn_demo_reset é SECURITY DEFINER.
-- CREATE OR REPLACE preserva a ACL viva (EXECUTE para owner, authenticated e service_role),
-- mas o gate estático exige a declaração explícita. Espelha a ACL viva; não amplia acesso.
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;
