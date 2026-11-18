-- PDCA GE · /dashboard/financeiro/cartoes · RD-69/RD-38 (code-desenvolvedor-3)
-- A jornada de cartão (adquirente -> taxa -> simulador -> repasse -> conciliação) está SAUDÁVEL;
-- o único gap é POLUIÇÃO de lista: o e2e de aceitação "CIELO ACEITE" (cartao-repasse-parcelas-3740.spec.ts)
-- criava adquirentes na DEMO Comércio (GE) e, ao limpar, só marcava ativo=false — deixando o registro VIVO
-- (deleted_at IS NULL). Resultado: ~1.4k adquirentes "CIELO ACEITE <run>-<rand>" acumulados na DEMO desde 21/10,
-- +~3/hora, poluindo a tabela e, em qualquer run que deixe um ativo, o seletor/lista da tela.
--
-- ESTA MIGRATION (aditiva, idempotente, só DEMO, só padrão de teste — NUNCA toca adquirente de cliente real):
--   1) fn_demo_ge_limpar_cartoes_teste(company): soft-delete (deleted_at + ativo=false, auditável) dos adquirentes
--      "CIELO ACEITE ...", suas taxas, os títulos de repasse de teste e a taxa_cartao (erp_pagar) ligada a eles.
--   2) roda a limpeza UMA vez na DEMO Comércio (GE) de produção (one-time).
--   3) liga a limpeza no fn_demo_reset da DEMO GE (-004) para o banco de testes não voltar a acumular.
-- O STOP de recorrência real é a correção do próprio e2e (afterEach soft-delete), nesta mesma PR.
--
-- RD-38 (provado em produção, BEGIN..ROLLBACK, DEMO b07...0004):
--   ANTES : adq_teste_vivos=1437 · adq_reais_vivos=0 · taxas_vivas=1437 · repasses_teste_vivos=3
--   DEPOIS: adq_teste_vivos=0    · adq_reais_vivos=0 · taxas_vivas=0    · repasses_teste_vivos=0
-- Nenhum adquirente real tocado (a DEMO GE não tem adquirente real). Soft-delete, nunca DELETE físico.

-- 1) Função de limpeza reutilizável (guarda is_demo; só padrão de teste; soft-delete rastreável)
CREATE OR REPLACE FUNCTION public.fn_demo_ge_limpar_cartoes_teste(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean;
  n_pag int := 0; n_rep int := 0; n_tax int := 0; n_adq int := 0;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo INTO v_is_demo FROM public.companies c WHERE c.id = p_company_id;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo'); END IF;

  -- "adquirentes de TESTE" = os criados pelo e2e "CIELO ACEITE <run>-<rand>" (nunca um adquirente real).
  -- Os adquirentes são soft-deletados POR ÚLTIMO, então o predicado `deleted_at IS NULL AND nome ~ '^CIELO ACEITE '`
  -- identifica o MESMO conjunto em cada passo abaixo (idempotente: a 2ª execução não encontra mais nada).

  -- (a) taxa_cartao (erp_pagar) ligada aos repasses de teste
  WITH rep AS (
    SELECT r.id FROM public.erp_receber r
     WHERE r.company_id = p_company_id AND r.eh_repasse_cartao IS TRUE AND r.deleted_at IS NULL
       AND r.adquirente_id IN (SELECT a.id FROM public.erp_cartao_adquirente a
                                WHERE a.company_id = p_company_id AND a.deleted_at IS NULL AND a.nome ~ '^CIELO ACEITE ')
  ), upd AS (
    UPDATE public.erp_pagar p SET deleted_at = now()
     WHERE p.company_id = p_company_id AND p.deleted_at IS NULL
       AND p.ref_externa_sistema = 'taxa_cartao' AND p.ref_externa_id IN (SELECT id::text FROM rep)
    RETURNING 1
  ) SELECT count(*) INTO n_pag FROM upd;

  -- (b) títulos de repasse de teste
  WITH upd AS (
    UPDATE public.erp_receber r SET deleted_at = now()
     WHERE r.company_id = p_company_id AND r.eh_repasse_cartao IS TRUE AND r.deleted_at IS NULL
       AND r.adquirente_id IN (SELECT a.id FROM public.erp_cartao_adquirente a
                                WHERE a.company_id = p_company_id AND a.deleted_at IS NULL AND a.nome ~ '^CIELO ACEITE ')
    RETURNING 1
  ) SELECT count(*) INTO n_rep FROM upd;

  -- (c) taxas dos adquirentes de teste
  WITH upd AS (
    UPDATE public.erp_cartao_taxa t SET deleted_at = now(), ativo = false, updated_at = now()
     WHERE t.company_id = p_company_id AND t.deleted_at IS NULL
       AND t.adquirente_id IN (SELECT a.id FROM public.erp_cartao_adquirente a
                                WHERE a.company_id = p_company_id AND a.deleted_at IS NULL AND a.nome ~ '^CIELO ACEITE ')
    RETURNING 1
  ) SELECT count(*) INTO n_tax FROM upd;

  -- (d) adquirentes de teste (POR ÚLTIMO)
  WITH upd AS (
    UPDATE public.erp_cartao_adquirente a SET deleted_at = now(), ativo = false, updated_at = now()
     WHERE a.company_id = p_company_id AND a.deleted_at IS NULL AND a.nome ~ '^CIELO ACEITE '
    RETURNING 1
  ) SELECT count(*) INTO n_adq FROM upd;

  RETURN jsonb_build_object('ok', true, 'adquirentes', n_adq, 'taxas', n_tax, 'repasses', n_rep, 'taxas_pagar', n_pag);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_ge_limpar_cartoes_teste(uuid) FROM PUBLIC, anon;

-- 2) limpeza one-time na DEMO Comércio (GE) de produção
SELECT public.fn_demo_ge_limpar_cartoes_teste('b0700000-0000-4000-a000-000000000004');

-- 3) ligar no reset da DEMO GE para não voltar a acumular no banco de testes
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
    -- 18/11 (code-desenvolvedor-3 · PDCA cartões): remove a poluição do e2e "CIELO ACEITE" na DEMO GE
    -- (adquirentes/taxas/repasses de teste), para a lista da tela de cartões não acumular entre rodadas.
    v_res := COALESCE(v_res, '{}'::jsonb)
      || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre)
      || jsonb_build_object('cartoes_limpeza', public.fn_demo_ge_limpar_cartoes_teste(p_company_id));
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

  -- 28/09: a demo nunca fica sem plano (menu vem só de módulo pago)
  v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('plano', public.fn_demo_garantir_plano(p_company_id));

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;
