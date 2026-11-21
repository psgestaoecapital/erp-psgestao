-- conserto-main 20/11 (gilberto-esteira): @pos-migration VERMELHO na main (portão false).
-- fn_demo_reset abortava com:
--   update or delete on table "prod_setor" violates foreign key constraint
--   "rh_vaga_setor_id_fkey" on table "rh_vaga"  (Key (id)=(...) is still referenced from table "rh_vaga")
-- Causa: a DEMO 005 (indústria/SST) apaga prod_setor no seed principal (fn_gold_sst_seed_reparar).
-- O seed 20261122103145_demo005_vagas_seed semeou rh_vaga (RD-98) referenciando prod_setor com FK RESTRICT,
-- um complemento de RH que o seed principal NÃO gerencia — igual ao rh_pessoa_complemento (conserto 14/11).
-- Por isso o DELETE de prod_setor passou a ser bloqueado e TODO o @pos caía no fn_demo_reset.
-- Prova (RD-38): rh_vaga tem company_id+setor_id; DEMO 005 tinha 3 vagas; nenhuma tabela referencia rh_vaga
-- (DELETE seguro); fn_demo_seed_industria_rh_quadro re-insere as vagas no fim (re-seed garantido).
-- Correção: limpar as vagas FICTÍCIAS da 005 ANTES dos seeds, no MESMO bloco do complemento. Dado 100% fake
-- (RD-69/LGPD), travado em is_demo; nenhum cliente é tocado. CREATE OR REPLACE idempotente.
-- ci-sem-guarda: fn_demo_reset — reset de DEMO; valida is_demo (rejeita não-DEMO) e opera apenas na company do parâmetro; não há "empresa do registro" a conferir
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
    -- conserto-main 20/11 (gilberto-esteira): rh_vaga (RD-98 vagas, seed 20261122103145) também referencia
    -- prod_setor (rh_vaga_setor_id_fkey, RESTRICT) e passou a bloquear o DELETE de prod_setor no seed principal,
    -- derrubando fn_demo_reset no @pos. Limpa as vagas FICTÍCIAS da 005 ANTES dos seeds; nada referencia rh_vaga
    -- (DELETE seguro) e fn_demo_seed_industria_rh_quadro as re-semeia no fim (mesmo padrão do complemento acima).
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

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

-- revoke_anon: declara explicitamente a ACL viva (CREATE OR REPLACE a preserva; anon já não executa).
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;
