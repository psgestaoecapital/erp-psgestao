-- PDCA P&M · /dashboard/pm/rentabilidade (aud8 92/95) — gap CRÍTICO (critério c / RD-98 pilar 1: dado REAL, não R$0 falso)
--
-- PROBLEMA (provado no dado, RD-38):
--   fn_pm_indiretas_rateio recorta o período das despesas indiretas por
--   `pg.data_competencia BETWEEN p_ini AND p_fim`, tanto no TOTAL das indiretas
--   quanto no balde "não classificado". Contas a pagar com data_competencia NULL
--   caem fora dos DOIS baldes e SOMEM sem aviso (false-zero).
--   • DEMO002 (Agência P&M, b07..0002): 11 despesas sem contrato, TODAS com
--     competência NULL -> total_indiretas=0 e nao_classificado.n=0 -> a tela mostra
--     o estado-vazio "Nenhuma despesa indireta para ratear no período".
--   • PRODUÇÃO: 1.618 de 15.264 contas a pagar vivas (~10,6%) têm competência NULL,
--     e TODAS têm data_vencimento (null_todas_datas=0) -> ~10% das indiretas somem
--     silenciosamente do cálculo de margem de TODA agência.
--
-- CORREÇÃO (aditiva, só leitura — CREATE OR REPLACE da RPC):
--   recortar o período por COALESCE(data_competencia, data_vencimento, data_emissao)
--   nas DUAS queries de erp_pagar (indiretas + não classificado), para que as linhas
--   de competência-NULL entrem no período pela melhor data disponível, em vez de
--   sumirem. Como no dado real nenhuma linha fica totalmente sem data, o COALESCE
--   recupera 100% das linhas antes perdidas e cada linha segue caindo em exatamente
--   UM balde (indiretas se casa plano de contas 'despesa', senão "não classificado").
--
-- DELIBERADO: a base por cliente (erp_receber) NÃO é alterada — mudar o corte do
--   receber mexeria na PARTICIPAÇÃO (%) de todo cliente de toda agência (raio muito
--   maior) e deslocaria os percentuais já auditados. O gap diagnosticado é só o corte
--   das INDIRETAS (pagar). O corte do receber fica para decisão própria, se desejado.
--
-- Prova RD-38 (BEGIN..ROLLBACK, DEMO002 2026-01-01..2026-11-12):
--   antes: n_atual_competencia=0 ; depois: 10 linhas no período (R$18.907,40, a 11ª
--   vence 17/11, fora do fim). Guarda de margem (fn_pm_pode_ver_margem) e demais
--   ramos intactos. SENSÍVEL (núcleo financeiro) -> revisao-eng-chefe.
--
-- Code: code-desenvolvedor-3

CREATE OR REPLACE FUNCTION public.fn_pm_indiretas_rateio(p_company_id uuid, p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  v_demo      boolean := false;
BEGIN
  -- Guarda: margem é sensível (mesma régua da visibilidade de margem). Fail-closed.
  IF NOT public.fn_pm_pode_ver_margem(p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  IF p_company_id IS NULL OR p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido');
  END IF;

  -- empresa de demonstração? (só então limpamos a marca técnica do nome exibido)
  SELECT COALESCE(bool_or(c.is_demo), false) INTO v_demo
    FROM public.companies c WHERE c.id = p_company_id;

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
  -- Corte por COALESCE(competência, vencimento, emissão): linhas de competência-NULL
  -- não somem do período (antes: `pg.data_competencia BETWEEN ...` as descartava).
  SELECT COALESCE(SUM(COALESCE(pg.valor, pg.valor_pago, 0)), 0)
    INTO v_total_ind
    FROM public.erp_pagar pg
    JOIN public.erp_plano_contas pc
      ON pc.company_id = pg.company_id AND pc.codigo = pg.categoria
   WHERE pg.company_id = p_company_id
     AND pg.deleted_at IS NULL
     AND pg.contrato_id IS NULL
     AND pc.tipo = 'despesa'
     AND COALESCE(pg.data_competencia, pg.data_vencimento, pg.data_emissao) BETWEEN p_ini AND p_fim;

  -- Não classificado (sem contrato, sem conta no plano) — devolvido à parte, NÃO rateado
  -- Mesmo corte COALESCE, para a linha de competência-NULL aparecer aqui (e não sumir).
  SELECT COUNT(*), COALESCE(SUM(COALESCE(pg.valor, pg.valor_pago, 0)), 0)
    INTO v_nc_n, v_nc_total
    FROM public.erp_pagar pg
    LEFT JOIN public.erp_plano_contas pc
      ON pc.company_id = pg.company_id AND pc.codigo = pg.categoria
   WHERE pg.company_id = p_company_id
     AND pg.deleted_at IS NULL
     AND pg.contrato_id IS NULL
     AND pc.id IS NULL
     AND COALESCE(pg.data_competencia, pg.data_vencimento, pg.data_emissao) BETWEEN p_ini AND p_fim;

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
                    -- SÓ na DEMO: remove um prefixo entre colchetes do nome exibido
                    -- (ex.: "[BOT] Cliente Agência" -> "Cliente Agência"). Produção: íntegro.
                    'cliente_nome',       CASE WHEN v_demo
                                               THEN regexp_replace(a.cliente_nome, '^\s*\[[^\]]+\]\s*', '')
                                               ELSE a.cliente_nome END,
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

-- Guarda de acesso (check-fn-guards): SECURITY DEFINER sem exposição a anon/PUBLIC.
-- Preserva o ACL vivo (authenticated + service_role executam; a própria RPC já é
-- fail-closed por fn_pm_pode_ver_margem). Sem mudança de acesso.
REVOKE ALL ON FUNCTION public.fn_pm_indiretas_rateio(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_indiretas_rateio(uuid, date, date) TO authenticated, service_role;
