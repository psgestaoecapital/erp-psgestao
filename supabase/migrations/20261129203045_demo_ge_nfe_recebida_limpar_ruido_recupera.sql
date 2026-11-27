-- PDCA GE (auditor_pdca_2, 26–27/11) · DEMO GE b0700000-0000-4000-a000-000000000004 · tela NF-e recebida (inbox).
-- desenvolvedor_4_g · RD-38 (provado no dado) · RD-69 (DEMO sem poluição de teste) · SÓ-DEMO (guarda is_demo).
--
-- RECUPERAÇÃO da #6348 (code-desenvolvedor-3): aquela PR mergeou mas a migration se PERDEU no squash/renumeração —
-- fn_demo_ge_nfe_limpar_ruido NÃO existe em produção e a versão 20261128134240 não está no ledger nem em origin/main.
-- Esta migration REAPLICA o fix a partir do corpo VIVO de fn_demo_reset (pg_get_functiondef, 27/11), NÃO do rascunho
-- da #6348 — o corpo vivo divergiu (hoje tem estoque_limpeza, não contas_limpeza; sem bloco 00b/nr36). Só ACRESCENTO
-- a chamada nfe_ruido_limpeza no bloco GE; todo o resto do fn_demo_reset é idêntico ao vivo (nada é revertido).
--
-- VEREDITO DO AUDITOR: a jornada da NF-e recebida (compra→nota→contas a pagar) está VERDE; o elo e a anti-regressão
-- (import_hash + lancado_pagar) estão INTACTOS — NÃO mexo nessa lógica. O ÚNICO gap é poluição de SEED: a inbox abre
-- dominada por eventos NSU/manifestação (só a chave, sem emitente e sem valor), dando aparência de tela MORTA.
--
-- PROVA RD-38 (read-only, 27/11, DEMO GE 004):
--   erp_nfe_recebidas DEMO 004: 4071 no total; 346 com resumo (emitente/valor) — preservadas.
--   RUÍDO = 3724 linhas aguardando_xml SEM emitente_razao, SEM valor_total, e SEM qualquer vínculo/filho:
--     0 lancado_pagar · 0 pedido_compra/fornecedor/xml/concluida · 0 itens · 0 duplicatas · 0 estorno.
--   RUÍDO com esse perfil em empresa NÃO-demo = 0 → a guarda is_demo NÃO toca nenhum cliente.
--   Origem: specs e2e fiscais inserem eventos-resumo NSU na DEMO de vitrine e não os limpam → acumulam (~108/dia).
-- SENSÍVEL (fiscal/DEMO): revisao-eng-chefe; SÓ-DEMO (toda escrita guardada por is_demo).

-- ── (0) Backup reversível (RLS ligada, REVOKE anon — gate RLS) ──
CREATE TABLE IF NOT EXISTS public.erp_nfe_recebidas_ruido_bkp_d4g (
  nfe_id        uuid PRIMARY KEY,
  company_id    uuid NOT NULL,
  chave_acesso  text,
  numero        text,
  dados         jsonb NOT NULL,
  capturado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_nfe_recebidas_ruido_bkp_d4g ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_nfe_recebidas_ruido_bkp_d4g FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.erp_nfe_recebidas_ruido_bkp_d4g TO service_role;

-- ── (1) Função de limpeza durável do ruído NSU/manifestação da inbox da DEMO ──
-- ci-sem-guarda: fn_demo_ge_nfe_limpar_ruido — função de DEMO (RD-69): grava SÓ em empresa is_demo (valida no topo);
--                nunca toca nota de cliente nem nota com emitente/valor/vínculo/itens. Só service_role (REVOKE anon).
CREATE OR REPLACE FUNCTION public.fn_demo_ge_nfe_limpar_ruido(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company AND c.is_demo = true) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo');
  END IF;

  -- Backup ANTES de remover (reversível: dados completos da linha). Idempotente (ON CONFLICT DO NOTHING).
  INSERT INTO public.erp_nfe_recebidas_ruido_bkp_d4g (nfe_id, company_id, chave_acesso, numero, dados)
  SELECT n.id, n.company_id, n.chave_acesso, n.numero, to_jsonb(n.*)
    FROM public.erp_nfe_recebidas n
   WHERE n.company_id = p_company
     AND n.status = 'aguardando_xml'
     AND COALESCE(n.emitente_razao, '') = '' AND n.valor_total IS NULL
     AND NOT COALESCE(n.lancado_pagar, false)
     AND n.pedido_compra_id IS NULL AND n.fornecedor_id IS NULL
     AND COALESCE(n.xml_raw, '') = '' AND n.concluida_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.erp_nfe_recebidas_itens i      WHERE i.nfe_recebida_id = n.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_nfe_recebidas_duplicatas d WHERE d.nfe_recebida_id = n.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_nfe_recebida_estorno e     WHERE e.nfe_recebida_id = n.id)
  ON CONFLICT (nfe_id) DO NOTHING;

  DELETE FROM public.erp_nfe_recebidas n
   WHERE n.company_id = p_company
     AND n.status = 'aguardando_xml'
     AND COALESCE(n.emitente_razao, '') = '' AND n.valor_total IS NULL
     AND NOT COALESCE(n.lancado_pagar, false)
     AND n.pedido_compra_id IS NULL AND n.fornecedor_id IS NULL
     AND COALESCE(n.xml_raw, '') = '' AND n.concluida_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.erp_nfe_recebidas_itens i      WHERE i.nfe_recebida_id = n.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_nfe_recebidas_duplicatas d WHERE d.nfe_recebida_id = n.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_nfe_recebida_estorno e     WHERE e.nfe_recebida_id = n.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'nfe_ruido_removidas', v_n);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_demo_ge_nfe_limpar_ruido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_ge_nfe_limpar_ruido(uuid) TO service_role;

-- ── (2) Limpeza one-time do backlog atual (a função valida is_demo internamente) ──
SELECT public.fn_demo_ge_nfe_limpar_ruido('b0700000-0000-4000-a000-000000000004'::uuid);

-- ── (3) CREATE OR REPLACE fn_demo_reset: corpo VIVO idêntico (pg_get_functiondef 27/11) + a chamada da limpeza no
--        bloco GE (004). Única diferença vs. o corpo vivo: a linha nfe_ruido_limpeza. Nada mais é alterado. ──
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
    -- 27/11 (desenvolvedor_4_g · PDCA NF-e recebida, recupera #6348): mesma lógica para erp_nfe_recebidas — remove o
    -- ruído NSU/manifestação (chave sem emitente/valor/vínculo) para a inbox de NF-e não abrir "morta" entre rodadas.
    v_res := COALESCE(v_res, '{}'::jsonb)
      || jsonb_build_object('comercial', v_com, 'financeiro', v_fin, 'bancos', v_ban, 'fiscal', v_fis, 'dre', v_dre)
      || jsonb_build_object('cartoes_limpeza', public.fn_demo_ge_limpar_cartoes_teste(p_company_id))
      || jsonb_build_object('estoque_limpeza', public.fn_demo_estoque_purgar_lixo_teste(p_company_id))
      || jsonb_build_object('nfe_ruido_limpeza', public.fn_demo_ge_nfe_limpar_ruido(p_company_id));
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

-- CREATE OR REPLACE preserva os grants existentes; reafirma a guarda (idempotente) — reset de DEMO nunca vai a anon.
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid) FROM PUBLIC, anon;
