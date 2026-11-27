-- PDCA GE · /dashboard/gestao-empresarial/comissoes-recorrentes (module_catalog ge_comissoes_recorrentes)
-- Code: code-desenvolvedor-3
--
-- Duas entregas (aditivas, núcleo GE):
--  1) HARDENING (fn_comissao_recorrente_painel): o CTE "lanc" fazia LEFT JOIN em erp_pagar
--     SEM filtrar p.deleted_at IS NULL. Se a conta a pagar da comissão fosse soft-deletada,
--     os KPIs comissao_a_pagar / comissao_vencida / paga_mes ainda liam o status/valor dela —
--     mesma classe de bug do fluxo-caixa. Fix: "AND p.deleted_at IS NULL" no join (conta a pagar
--     deletada passa a não-existente). Aditivo, não muda o cálculo do caso normal.
--     Prova RD-38 (BEGIN..ROLLBACK, prod DEMO): após soft-delete da conta a pagar gerada,
--     join antigo somava R$60 (errado) e o join novo soma R$0 (correto).
--  2) SEED DEMONSTRÁVEL na DEMO GE (fn_demo_ge_comissao_recorrente_seed): a jornada que é o
--     CORAÇÃO da tela (cliente paga -> sistema identifica -> nasce a conta a pagar do vendedor,
--     pendente) não aparecia porque a DEMO GE (b0700000-...-004) tinha 0 regras e 0 lançamentos.
--     Função idempotente, guardada por companies.is_demo = true, cria 1 vendedor (fornecedor com
--     PIX), 1 regra de comissão % no contrato de receita DEMO-GE-FIN existente, e um recebível PAGO
--     que dispara o gatilho trg_zz_comissao_recorrente -> >=1 lançamento "gerada" ligado a 1 conta
--     a pagar pendente. Chamada uma vez ao fim desta migration.
--     (Hook durável no fn_demo_seed_ge_financeiro deixado como follow-up: hoje a função é reescrita
--      por PRs de purga em voo (#5929/#5747); evita-se colisão/revert — a função de seed abaixo é
--      reexecutável a qualquer momento, pois acha o contrato pelo NOME estável a cada rodada.)

-- ============================================================================
-- 1) HARDENING: fn_comissao_recorrente_painel ignora conta a pagar soft-deletada
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_painel(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ini date := date_trunc('month', current_date)::date; v_fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date; v jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  WITH regras AS (
    SELECT g.*, c.nome AS contrato_nome, c.numero AS contrato_numero, c.cliente_nome, c.status AS contrato_status,
           c.data_suspensao, c.data_encerramento, c.data_fim,
           coalesce(c.valor_atual, c.valor_mensal, 0) AS valor_mensal,
           coalesce(nullif(btrim(g.vertical), ''), nullif(btrim(c.tipo), ''), 'Sem vertical') AS vert,
           coalesce(nullif(f.nome_fantasia, ''), f.razao_social, 'Vendedor') AS vendedor
      FROM public.erp_comissao_recorrente_regra g
      JOIN public.erp_contratos c ON c.id = g.contrato_id AND c.company_id = g.company_id
      JOIN public.erp_fornecedores f ON f.id = g.fornecedor_id
     WHERE g.company_id = p_company_id AND g.deleted_at IS NULL AND c.excluido_em IS NULL
  ), ativas AS (
    SELECT *, round(CASE WHEN tipo_comissao = 'percentual' THEN percentual / 100.0 * valor_mensal ELSE valor_fixo END, 2) AS prevista,
           CASE WHEN data_fim IS NULL THEN 12
                WHEN data_fim < current_date THEN 0 ELSE (extract(year FROM age(data_fim, current_date)) * 12 + extract(month FROM age(data_fim, current_date)))::int + 1 END AS meses_restantes
      FROM regras
     WHERE ativo AND contrato_status = 'ativo' AND vigencia_inicio <= v_fim AND (vigencia_fim IS NULL OR vigencia_fim >= current_date)
  ), lanc AS (
    SELECT l.*, coalesce(p.valor_pago, 0) AS pago_vendedor, p.data_pagamento AS pago_em, p.status AS pagar_status, p.data_vencimento AS pagar_venc
      FROM public.erp_comissao_recorrente_lancamento l
      LEFT JOIN public.erp_pagar p ON p.id = l.pagar_id AND p.deleted_at IS NULL
     WHERE l.company_id = p_company_id AND l.status = 'gerada'
  )
  SELECT jsonb_build_object(
    'ok', true,
    'mes', to_char(v_ini, 'YYYY-MM'),
    'kpis', jsonb_build_object(
      'mrr_com_comissao', (SELECT coalesce(sum(valor_mensal), 0) FROM (SELECT DISTINCT contrato_id, valor_mensal FROM ativas) x),
      'contratos_com_comissao', (SELECT count(DISTINCT contrato_id) FROM ativas),
      'comissao_prevista_mes', (SELECT coalesce(sum(prevista), 0) FROM ativas),
      'comissao_gerada_mes', (SELECT coalesce(sum(valor_comissao), 0) FROM lanc WHERE competencia BETWEEN v_ini AND v_fim),
      'comissao_paga_mes', (SELECT coalesce(sum(pago_vendedor), 0) FROM lanc WHERE pago_em BETWEEN v_ini AND v_fim),
      'comissao_a_pagar', (SELECT coalesce(sum(valor_comissao - pago_vendedor), 0) FROM lanc WHERE pagar_status IN ('aberto', 'vencido', 'parcial', 'agendado', 'incluido_remessa')),
      'comissao_vencida', (SELECT coalesce(sum(valor_comissao - pago_vendedor), 0) FROM lanc WHERE pagar_status IN ('vencido') OR (pagar_status IN ('aberto', 'parcial') AND pagar_venc < current_date)),
      'vendedores_ativos', (SELECT count(DISTINCT fornecedor_id) FROM ativas),
      'erros_7d', (SELECT count(*) FROM public.erp_comissao_recorrente_evento WHERE company_id = p_company_id AND tipo = 'erro' AND created_at > now() - interval '7 days'),
      'pendencias_estorno', (SELECT count(*) FROM public.erp_comissao_recorrente_lancamento WHERE company_id = p_company_id AND status = 'estornada' AND pendencia IS NOT NULL)
    ),
    'por_vertical', coalesce((SELECT jsonb_agg(x ORDER BY x.prevista DESC) FROM (
        SELECT a.vert AS vertical, count(DISTINCT a.contrato_id) AS contratos,
               (SELECT coalesce(sum(vm), 0) FROM (SELECT DISTINCT b.contrato_id, b.valor_mensal AS vm FROM ativas b WHERE b.vert = a.vert) y) AS mrr,
               sum(a.prevista) AS prevista,
               (SELECT coalesce(sum(l.valor_comissao), 0) FROM lanc l JOIN regras rr ON rr.id = l.regra_id
                 WHERE rr.vert = a.vert AND l.competencia BETWEEN v_ini AND v_fim) AS gerada_mes
          FROM ativas a GROUP BY a.vert) x), '[]'::jsonb),
    'por_vendedor', coalesce((SELECT jsonb_agg(x ORDER BY x.prevista DESC) FROM (
        SELECT v.fornecedor_id, v.vendedor, v.contratos, v.prevista, v.projecao,
               coalesce((SELECT sum(valor_comissao) FROM lanc l WHERE l.fornecedor_id = v.fornecedor_id AND l.competencia BETWEEN v_ini AND v_fim), 0) AS gerada_mes,
               coalesce((SELECT sum(pago_vendedor) FROM lanc l WHERE l.fornecedor_id = v.fornecedor_id AND l.pago_em BETWEEN v_ini AND v_fim), 0) AS paga_mes,
               coalesce((SELECT sum(valor_comissao) FROM lanc l WHERE l.fornecedor_id = v.fornecedor_id), 0) AS acumulado,
               coalesce((SELECT sum(valor_comissao - pago_vendedor) FROM lanc l WHERE l.fornecedor_id = v.fornecedor_id AND l.pagar_status IN ('aberto', 'vencido', 'parcial', 'agendado', 'incluido_remessa')), 0) AS a_pagar
          FROM (SELECT fornecedor_id, min(vendedor) AS vendedor, count(DISTINCT contrato_id) AS contratos, sum(prevista) AS prevista,
                       sum(prevista * meses_restantes) AS projecao
                  FROM ativas GROUP BY fornecedor_id) v) x), '[]'::jsonb),
    'alertas_corte', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'contrato_id', contrato_id, 'contrato', coalesce(nullif(contrato_nome, ''), contrato_numero), 'cliente', cliente_nome,
          'vendedor', vendedor, 'status', contrato_status, 'desde', coalesce(data_suspensao, data_encerramento)) ORDER BY coalesce(data_suspensao, data_encerramento) DESC NULLS LAST)
        FROM regras WHERE ativo AND contrato_status IN ('suspenso', 'encerrado')), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_painel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_painel(uuid) TO authenticated, service_role;

-- ============================================================================
-- 2) SEED demonstrável da jornada de comissão recorrente na DEMO GE
--    (idempotente · só empresa is_demo · reexecutável)
-- ============================================================================
-- ci-sem-guarda: fn_demo_ge_comissao_recorrente_seed — seed de demonstração executado só pela conexão de serviço (GRANT só service_role, sem auth.uid()); já guardado por companies.is_demo = true (retorna 'so_empresa_demo' fora da DEMO), nunca toca empresa de cliente real.
CREATE OR REPLACE FUNCTION public.fn_demo_ge_comissao_recorrente_seed(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_demo boolean;
  v_ct uuid; v_cli uuid; v_cli_nome text; v_vig date;
  v_forn uuid; v_rec uuid;
  v_lanc int; v_valor numeric; v_pagar int;
BEGIN
  -- Guarda so-demo: só empresa de demonstração (nunca dado de cliente real).
  SELECT coalesce(is_demo, false) INTO v_is_demo FROM public.companies WHERE id = p_company;
  IF NOT coalesce(v_is_demo, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo');
  END IF;

  -- Contrato de RECEITA da DEMO GE (nome estável; id muda a cada reset do seed).
  SELECT id, cliente_id, cliente_nome, coalesce(data_inicio, current_date - 150)
    INTO v_ct, v_cli, v_cli_nome, v_vig
  FROM public.erp_contratos
  WHERE company_id = p_company AND nome LIKE 'DEMO-GE-FIN Mensalidade%' AND excluido_em IS NULL
  ORDER BY created_at LIMIT 1;

  IF v_ct IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'motivo', 'contrato_demo_ausente');
  END IF;
  IF v_cli IS NULL THEN
    SELECT id, nome_fantasia INTO v_cli, v_cli_nome FROM public.erp_clientes
     WHERE company_id = p_company ORDER BY created_at, id LIMIT 1;
  END IF;

  -- ── Limpeza idempotente do seed anterior (FK-safe) ──
  SELECT id INTO v_forn FROM public.erp_fornecedores
   WHERE company_id = p_company AND razao_social = 'DEMO-GE-FIN Vendedor Comissão' LIMIT 1;
  IF v_forn IS NOT NULL THEN
    DELETE FROM public.erp_comissao_recorrente_evento
     WHERE company_id = p_company
       AND (regra_id IN (SELECT id FROM public.erp_comissao_recorrente_regra WHERE company_id = p_company AND fornecedor_id = v_forn)
            OR lancamento_id IN (SELECT id FROM public.erp_comissao_recorrente_lancamento WHERE company_id = p_company AND fornecedor_id = v_forn));
    DELETE FROM public.erp_comissao_recorrente_lancamento WHERE company_id = p_company AND fornecedor_id = v_forn;
    PERFORM set_config('app.permitir_delete_fisico', 'on', true);
    DELETE FROM public.erp_pagar WHERE company_id = p_company AND fornecedor_id = v_forn AND categoria = 'Comissão recorrente';
    DELETE FROM public.erp_receber WHERE company_id = p_company AND numero_documento = 'DEMO-GE-FIN-COM1';
    PERFORM set_config('app.permitir_delete_fisico', 'off', true);
    DELETE FROM public.erp_comissao_recorrente_regra WHERE company_id = p_company AND fornecedor_id = v_forn;
    DELETE FROM public.erp_fornecedores WHERE id = v_forn;
  END IF;

  -- ── Vendedor (fornecedor com PIX) ──
  INSERT INTO public.erp_fornecedores (company_id, razao_social, nome_fantasia, cnpj_cpf, pix, ativo, created_at)
  VALUES (p_company, 'DEMO-GE-FIN Vendedor Comissão', 'Vendedor Comissão (DEMO)', NULL,
          'vendedor.comissao.demo@pix.exemplo', true, now())
  RETURNING id INTO v_forn;

  -- ── Regra de comissão: 5% do valor pago, vence em 7 dias ──
  INSERT INTO public.erp_comissao_recorrente_regra
    (company_id, contrato_id, fornecedor_id, tipo_comissao, percentual, base, dias_vencimento, vigencia_inicio, ativo, observacao, created_at, updated_at)
  VALUES (p_company, v_ct, v_forn, 'percentual', 5, 'valor_pago', 7, v_vig, true,
          'Comissão recorrente de demonstração (5% do recebido ao vendedor)', now(), now());

  -- ── Recebível PAGO que dispara o gatilho de comissão ──
  INSERT INTO public.erp_receber
    (company_id, cliente_id, cliente_nome, data_emissao, data_vencimento, valor, status, categoria, centro_custo,
     numero_documento, descricao, parcela, data_competencia, contrato_id, created_at)
  VALUES (p_company, v_cli, v_cli_nome, current_date - 20, current_date - 5, 1200.00, 'aberto', 'Receita de vendas', 'COMERCIAL',
          'DEMO-GE-FIN-COM1', 'Mensalidade paga (demonstração da comissão recorrente)', '1/1',
          date_trunc('month', (current_date - 20))::date, v_ct, now())
  RETURNING id INTO v_rec;

  -- Baixa integral -> trg_zz_comissao_recorrente -> gera lançamento + conta a pagar pendente.
  PERFORM public.fn_receber_baixar_pagamento(v_rec, current_date - 5, NULL, 'PIX', NULL, 'manual');

  SELECT count(*), coalesce(sum(valor_comissao), 0)
    INTO v_lanc, v_valor
  FROM public.erp_comissao_recorrente_lancamento WHERE recebivel_id = v_rec AND status = 'gerada';
  SELECT count(*) INTO v_pagar FROM public.erp_pagar
   WHERE company_id = p_company AND fornecedor_id = v_forn AND categoria = 'Comissão recorrente' AND deleted_at IS NULL AND status = 'aberto';

  RETURN jsonb_build_object('ok', true, 'contrato', v_ct, 'vendedor', v_forn, 'recebivel', v_rec,
    'lancamentos_gerada', v_lanc, 'comissao_valor', v_valor, 'conta_a_pagar_pendente', v_pagar);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_ge_comissao_recorrente_seed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_ge_comissao_recorrente_seed(uuid) TO service_role;

-- ── Semeia agora a DEMO GE (idempotente; a função barra empresa não-demo) ──
SELECT public.fn_demo_ge_comissao_recorrente_seed('b0700000-0000-4000-a000-000000000004');
