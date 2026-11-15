-- PS EHS · DEMO durável — matrizes S1 (risco/EPI/treinamento) sobrevivem ao fn_demo_reset
--
-- DEFEITO (RD-52, achado na verificação pós-deploy do #5170): os seeds das migrations S1.1/S1.2/S1.3 são
-- ONE-SHOT. O fn_demo_reset da DEMO 005 (indústria/abatedouro) roda fn_gold_sst_seed_reparar (apaga e
-- reconstrói prod_*) e os complementos fn_demo_seed_industria_postos/_frota — mas NÃO re-semeia as matrizes
-- EHS. Resultado: a cada reset, prod_setor_risco / prod_posto_epi / prod_posto_treinamento voltam a 0 e o
-- piloto da DEMO fica sem dado (os catálogos epi_catalogo/nr_treinamento_tipo sobrevivem).
--
-- CONSERTO (padrão estabelecido — igual a postos 08/11 e frota 12/11): uma função fn_demo_seed_ehs_matrizes
-- idempotente + UMA chamada no fn_demo_reset, DEPOIS dos postos (que as matrizes referenciam). Aditiva e
-- travada em is_demo; RD-69 (tudo FAKE, nenhum cliente é tocado). Reverter = voltar o fn_demo_reset sem a
-- chamada e dropar a função (nada destrutivo roda na aplicação).

-- 1) Seeder das matrizes EHS (S1.1 risco por setor · S1.2 EPI por posto · S1.3 treinamento por posto).
-- ci-sem-guarda: fn_demo_seed_ehs_matrizes — seed de DEMO, trava em is_demo (RD-69); nenhum dado de cliente.
CREATE OR REPLACE FUNCTION public.fn_demo_seed_ehs_matrizes(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_is_demo boolean;
  v_plant uuid;
  v_riscos int; v_epis int; v_treinos int;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo INTO v_is_demo FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo'); END IF;

  -- plant base para setores novos (herda de um setor já existente da empresa)
  SELECT plant_id INTO v_plant FROM public.prod_setor
    WHERE company_id = p_company_id AND plant_id IS NOT NULL ORDER BY ordem NULLS LAST LIMIT 1;

  -- setores sem posto que as matrizes de risco usam (Expedição/Administrativo), idempotente por nome
  INSERT INTO public.prod_setor (company_id, plant_id, nome, ordem, ativo)
  SELECT p_company_id, v_plant, v.nome, v.ordem, true
  FROM (VALUES ('Expedição',30),('Administrativo',40)) AS v(nome, ordem)
  WHERE v_plant IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.prod_setor ps
      WHERE ps.company_id = p_company_id AND lower(ps.nome) = lower(v.nome));

  -- S1.1 · riscos por setor (idempotente por setor+descrição)
  INSERT INTO public.prod_setor_risco (company_id, setor_id, tipo, descricao, grau)
  SELECT p_company_id, ps.id, r.tipo, r.descricao, r.grau
  FROM (VALUES
    ('Abate','fisico','Ruído contínuo das serras acima de 85 dB(A)','alto'),
    ('Abate','fisico','Frio e umidade na área de abate','medio'),
    ('Abate','acidente','Corte com faca e serra na linha','alto'),
    ('Desossa','ergonomico','Movimento repetitivo e postura forçada na desossa','alto'),
    ('Desossa','fisico','Frio na sala de desossa','medio'),
    ('Desossa','acidente','Corte com faca na desossa','alto'),
    ('Expedição','fisico','Frio na câmara de expedição','medio'),
    ('Expedição','acidente','Movimentação de cargas e trânsito de empilhadeira','medio'),
    ('Administrativo','ergonomico','Postura sentada prolongada em frente ao computador','leve')
  ) AS r(setor_nome, tipo, descricao, grau)
  JOIN public.prod_setor ps ON ps.company_id = p_company_id AND lower(ps.nome) = lower(r.setor_nome) AND ps.ativo
  WHERE NOT EXISTS (SELECT 1 FROM public.prod_setor_risco sr
    WHERE sr.company_id = p_company_id AND sr.setor_id = ps.id AND sr.descricao = r.descricao);
  GET DIAGNOSTICS v_riscos = ROW_COUNT;

  -- S1.2 · EPIs por posto (todos os postos do setor; idempotente por UNIQUE(posto_id,catalogo_id))
  INSERT INTO public.prod_posto_epi (company_id, posto_id, catalogo_id, obrigatorio, observacao)
  SELECT p_company_id, po.id, ec.id, true, NULL
  FROM public.prod_posto po
  JOIN public.prod_setor s ON s.id = po.setor_id
  JOIN (VALUES
    ('Abate','Protetor auricular tipo plug'),('Abate','Japona térmica para câmara'),('Abate','Luva de malha de aço'),
    ('Desossa','Luva de malha de aço'),('Desossa','Japona térmica para câmara'),('Desossa','Avental impermeável')
  ) AS m(setor_nome, epi_nome) ON lower(s.nome) = lower(m.setor_nome)
  JOIN public.epi_catalogo ec ON ec.company_id = p_company_id AND lower(ec.nome) = lower(m.epi_nome)
  WHERE po.company_id = p_company_id
  ON CONFLICT (posto_id, catalogo_id) DO NOTHING;
  GET DIAGNOSTICS v_epis = ROW_COUNT;

  -- S1.3 · treinamentos por posto (NR-36+NR-06 em todos; NR-12 nos de faca/máquina, 1 recomendado)
  INSERT INTO public.prod_posto_treinamento (company_id, posto_id, tipo_id, obrigatorio)
  SELECT p_company_id, po.id, t.id, m.obrig
  FROM public.prod_posto po
  JOIN public.prod_setor s ON s.id = po.setor_id
  JOIN (VALUES
    ('Abate','01','NR-36', true),  ('Abate','01','NR-06', true),  ('Abate','01','NR-12', true),
    ('Abate','02','NR-36', true),  ('Abate','02','NR-06', true),
    ('Abate','03','NR-36', true),  ('Abate','03','NR-06', true),  ('Abate','03','NR-12', true),
    ('Abate','04','NR-36', true),  ('Abate','04','NR-06', true),  ('Abate','04','NR-12', true),
    ('Abate','05','NR-36', true),  ('Abate','05','NR-06', true),
    ('Abate','06','NR-36', true),  ('Abate','06','NR-06', true),
    ('Desossa','01','NR-36', true),('Desossa','01','NR-06', true),('Desossa','01','NR-12', true),
    ('Desossa','02','NR-36', true),('Desossa','02','NR-06', true),('Desossa','02','NR-12', true),
    ('Desossa','03','NR-36', true),('Desossa','03','NR-06', true),('Desossa','03','NR-12', true),
    ('Desossa','04','NR-36', true),('Desossa','04','NR-06', true),('Desossa','04','NR-12', false),
    ('Desossa','05','NR-36', true),('Desossa','05','NR-06', true)
  ) AS m(setor_nome, num, nr, obrig) ON lower(s.nome) = lower(m.setor_nome) AND po.numero = m.num
  JOIN public.nr_treinamento_tipo t ON t.company_id = p_company_id AND t.nr_codigo = m.nr AND t.ativo
  WHERE po.company_id = p_company_id
  ON CONFLICT (posto_id, tipo_id) DO NOTHING;
  GET DIAGNOSTICS v_treinos = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'riscos_novos', v_riscos, 'epis_novos', v_epis, 'treinos_novos', v_treinos);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_ehs_matrizes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_demo_seed_ehs_matrizes(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_ehs_matrizes(uuid) TO service_role;

-- 2) fn_demo_reset: reproduzido VERBATIM + UMA chamada ao seeder das matrizes, logo após os postos da 005.
-- ci-sem-guarda: fn_demo_reset — reset de DEMO, trava em is_demo logo no início; nenhum dado de cliente.
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

  -- 15/11 (code-desenvolvedor-3 · EHS S1 piloto): matrizes de risco (S1.1), EPI (S1.2) e treinamento (S1.3)
  -- por setor/posto. Os seeds das migrations são one-shot e o reset os apagava; aqui ficam DURÁVEIS a cada
  -- reset. Roda DEPOIS dos postos (precisa dos postos/setores). RD-69: tudo FAKE; trava is_demo na função.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('ehs_matrizes', public.fn_demo_seed_ehs_matrizes(p_company_id));
  END IF;

  -- 12/11 (desenvolvedor_4_g · PDCA aud8 Controle de frota, DEMO 005): frota FICTÍCIA (veículos + planos de
  -- manutenção + documentos + custos + viagens/abastecimento) para os 6 KPIs da tela de frota deixarem de
  -- ficar zerados e a jornada de inclusão/edição/custo ser verificável. RD-69: tudo FAKE. Idempotente e is_demo.
  IF p_company_id = 'b0700000-0000-4000-a000-000000000005'::uuid THEN
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('frota', public.fn_demo_seed_industria_frota(p_company_id));
  END IF;

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid) TO authenticated, service_role;
