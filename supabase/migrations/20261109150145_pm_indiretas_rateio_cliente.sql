-- P&M · Rateio das despesas INDIRETAS da GE por cliente (slice 1 da margem por cliente/serviço)
-- Blueprint P&M §3/§6: margem = receita do cliente − (custo direto das etapas medidas + indiretas da GE rateadas por cliente).
-- Esta RPC entrega SÓ a parte "indiretas rateadas por cliente". Lê da GE, NÃO recria/grava financeiro (somente leitura).
--
-- Definições (decisão do eng_chefe, provadas no dado — RD-38):
--   Plano canônico = public.erp_plano_contas (1840 linhas; por empresa). O de-para é erp_pagar.categoria = erp_plano_contas.codigo
--   (mesmo company_id). Tipos do plano: custo | despesa | financeiro | investimento | receita.
--   INDIRETAS = erp_pagar sem contrato (contrato_id IS NULL) cuja conta no plano tem tipo='despesa', por data_competencia.
--   (Diretas = contrato_id OU tipo='custo'; investimento/financeiro ficam de fora da base de indiretas.)
--   NÃO CLASSIFICADO = erp_pagar sem contrato cuja categoria NÃO casa com nenhuma conta do plano. NÃO é rateado:
--   é devolvido à parte (n + valor) para a tela mostrar honestamente "despesas a classificar" (RD-38), sem mascarar.
--   RATEIO por participação do cliente no critério configurado (agency_rateio_config.criterio): 'receita' (padrão) ou 'horas'.
--     receita → base = erp_receber por cliente (data_competencia); nome denormalizado em erp_receber.cliente_nome.
--     horas   → base = agency_timesheet.horas por cliente (data); nome em agency_clientes.
--   O resto de centavo do arredondamento vai para o cliente de maior base, para SUM(indiretas_rateadas) = total_indiretas.
--
-- Prova RD-38 (PDOIS 36b69d77…, jan–out/2026, critério receita): total_indiretas R$ 989.530,38 (842 lançamentos);
--   não_classificado R$ 203.268,03 (99 lançamentos); base receita R$ 714.131,84 em 135 clientes;
--   SUM(indiretas_rateadas) reconcilia com total_indiretas (resto de centavo no maior).
--
-- Segurança: SECURITY DEFINER, search_path fixo, guarda de visibilidade de margem (fn_pm_pode_ver_margem, fail-closed);
--   REVOKE de public/anon, EXECUTE só para authenticated/service_role. Aditiva/idempotente (CREATE OR REPLACE, nova função).

CREATE OR REPLACE FUNCTION public.fn_pm_indiretas_rateio(
  p_company_id uuid,
  p_ini date,
  p_fim date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_criterio  text;
  v_unidade   text;
  v_total_ind numeric := 0;
  v_nc_total  numeric := 0;
  v_nc_n      integer := 0;
  v_base_total numeric := 0;
  v_clientes  jsonb := '[]'::jsonb;
BEGIN
  -- Guarda: margem é sensível (mesma régua da visibilidade de margem). Fail-closed.
  IF NOT public.fn_pm_pode_ver_margem(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  IF p_company_id IS NULL OR p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido');
  END IF;

  -- Critério de rateio (padrão receita)
  SELECT COALESCE(NULLIF(c.criterio, ''), 'receita') INTO v_criterio
    FROM public.agency_rateio_config c
   WHERE c.company_id = p_company_id;
  v_criterio := COALESCE(v_criterio, 'receita');
  IF v_criterio NOT IN ('receita', 'horas') THEN
    v_criterio := 'receita';
  END IF;
  v_unidade := CASE WHEN v_criterio = 'horas' THEN 'horas' ELSE 'receita' END;

  -- Total das indiretas (despesa, sem contrato, por competência)
  SELECT COALESCE(SUM(COALESCE(pg.valor, pg.valor_pago, 0)), 0)
    INTO v_total_ind
    FROM public.erp_pagar pg
    JOIN public.erp_plano_contas pc
      ON pc.company_id = pg.company_id AND pc.codigo = pg.categoria
   WHERE pg.company_id = p_company_id
     AND pg.deleted_at IS NULL
     AND pg.contrato_id IS NULL
     AND pc.tipo = 'despesa'
     AND pg.data_competencia BETWEEN p_ini AND p_fim;

  -- Não classificado (sem contrato, sem conta no plano) — devolvido à parte, NÃO rateado
  SELECT COUNT(*), COALESCE(SUM(COALESCE(pg.valor, pg.valor_pago, 0)), 0)
    INTO v_nc_n, v_nc_total
    FROM public.erp_pagar pg
    LEFT JOIN public.erp_plano_contas pc
      ON pc.company_id = pg.company_id AND pc.codigo = pg.categoria
   WHERE pg.company_id = p_company_id
     AND pg.deleted_at IS NULL
     AND pg.contrato_id IS NULL
     AND pc.id IS NULL
     AND pg.data_competencia BETWEEN p_ini AND p_fim;

  -- Base por cliente + rateio (só o ramo do critério ativo é varrido; o outro tem predicado constante-falso)
  WITH base AS (
    SELECT s.cliente_id, s.cliente_nome, s.base
    FROM (
      SELECT r.cliente_id,
             COALESCE(MAX(NULLIF(r.cliente_nome, '')), '(sem nome)') AS cliente_nome,
             SUM(COALESCE(r.valor, r.valor_pago, 0))::numeric        AS base
        FROM public.erp_receber r
       WHERE v_criterio = 'receita'
         AND r.company_id = p_company_id
         AND r.deleted_at IS NULL
         AND r.cliente_id IS NOT NULL
         AND r.data_competencia BETWEEN p_ini AND p_fim
       GROUP BY r.cliente_id
      UNION ALL
      SELECT t.cliente_id,
             COALESCE(MAX(COALESCE(ac.nome_fantasia, ac.nome)), '(sem nome)') AS cliente_nome,
             SUM(t.horas)::numeric                                             AS base
        FROM public.agency_timesheet t
        LEFT JOIN public.agency_clientes ac
          ON ac.id = t.cliente_id AND ac.company_id = t.company_id
       WHERE v_criterio = 'horas'
         AND t.company_id = p_company_id
         AND t.cliente_id IS NOT NULL
         AND t.data BETWEEN p_ini AND p_fim
       GROUP BY t.cliente_id
    ) s
    WHERE s.base > 0
  ),
  tot AS (SELECT COALESCE(SUM(base), 0) AS bt FROM base),
  calc AS (
    SELECT b.cliente_id, b.cliente_nome, b.base,
           round(b.base / NULLIF(t.bt, 0) * 100, 2)              AS pct,
           round(v_total_ind * b.base / NULLIF(t.bt, 0), 2)      AS rateada,
           row_number() OVER (ORDER BY b.base DESC, b.cliente_id) AS rn
      FROM base b CROSS JOIN tot t
  ),
  resid AS (SELECT v_total_ind - COALESCE(SUM(rateada), 0) AS r FROM calc),
  adj AS (
    SELECT c.cliente_id, c.cliente_nome, c.base, c.pct,
           CASE WHEN c.rn = 1 THEN c.rateada + COALESCE((SELECT r FROM resid), 0)
                ELSE c.rateada END AS rateada
      FROM calc c
  )
  SELECT (SELECT round(bt, 2) FROM tot),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'cliente_id',         a.cliente_id,
                    'cliente_nome',       a.cliente_nome,
                    'base',               round(a.base, 2),
                    'participacao_pct',   a.pct,
                    'indiretas_rateadas', a.rateada
                  ) ORDER BY a.base DESC, a.cliente_id)
           FROM adj a
         ), '[]'::jsonb)
    INTO v_base_total, v_clientes;

  RETURN jsonb_build_object(
    'ok',               true,
    'company_id',       p_company_id,
    'periodo',          jsonb_build_object('ini', p_ini, 'fim', p_fim),
    'criterio',         v_criterio,
    'base_unidade',     v_unidade,
    'total_indiretas',  round(v_total_ind, 2),
    'base_total',       round(v_base_total, 2),
    'nao_classificado', jsonb_build_object('n', v_nc_n, 'valor', round(v_nc_total, 2)),
    'clientes',         v_clientes
  );
END
$function$;

REVOKE ALL ON FUNCTION public.fn_pm_indiretas_rateio(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_pm_indiretas_rateio(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_indiretas_rateio(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_indiretas_rateio(uuid, date, date) TO service_role;

COMMENT ON FUNCTION public.fn_pm_indiretas_rateio(uuid, date, date) IS
  'P&M: rateia as despesas indiretas da GE (erp_pagar tipo=despesa, sem contrato, por competência) entre os clientes por participação de receita ou horas (agency_rateio_config). Somente leitura; devolve não_classificado à parte (RD-38). Guarda fn_pm_pode_ver_margem.';
