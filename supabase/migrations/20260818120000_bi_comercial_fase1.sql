-- BI Comercial Frioeste · Fase 1 (ATAK) — RBAC por vendedor + KPIs/série/pareto/ranking sobre o raw
--
-- Fonte: ind_atak_fato dom='comercial_vendas' (655 fatos, 9 vendedores). Campos do raw: PESO, VALOR, LUCRO,
-- COD_CLI_FOR, NOME_PARTICIPANTE, COD_VEND_COMP, NOME_VENDEDOR, COD_SUPERVISOR, NOME_SUPERVISOR, COD_FILIAL,
-- DATA_ESTOQUE (ISO timestamptz). Lê o raw direto (o canônico não tem LUCRO) + gating por login (RD-41).
--
-- RBAC (fail-closed, trava no SERVIDOR): vendedor (tem de-para) → forçado ao próprio COD_VEND_COMP, ignora
-- p_vendedor; líder (CLIENT_OWNER/MANAGER, ou observacao diretor_vendas/assistente_vendas, ou admin) →
-- global ou p_vendedor; ninguém mapeado/sem papel → sem_acesso_comercial.
--
-- ⚠️ ACHADO DE DADO (RD-58/RD-51): o campo LUCRO do raw ATAK está CORROMPIDO NA ORIGEM (view SQL Server).
-- 655 fatos: 188 linhas com |LUCRO| > VALOR (lucro maior que a própria receita = impossível), valores em
-- bilhões aleatórios (min -1.13bi, max +544mi), margem média das "plausíveis" = 92.84% (irreal p/ atacado).
-- SUM(LUCRO) global = -1.36 bilhão. NÃO dá pra derivar Lucro/Margem honesto disso. Em vez de mostrar número
-- falso, as RPCs calculam um selo de confiabilidade (n_implausiveis/n < 2%): se o LUCRO não é confiável,
-- retornam lucro=null + lucro_status='aguardando_dado_confiavel' (o front mostra card honesto). Quando a origem
-- corrigir o LUCRO, o selo vira confiável sozinho e os números aparecem — sem tocar em código.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) De-para login → vendedor do ATAK
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bi_comercial_vendedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  cod_vend_comp text NOT NULL,
  criado_em timestamptz DEFAULT now(),
  UNIQUE (company_id, user_id)
);
ALTER TABLE public.bi_comercial_vendedor ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bi_comercial_vendedor' AND policyname='p_bcv_tenant') THEN
    CREATE POLICY p_bcv_tenant ON public.bi_comercial_vendedor
      FOR ALL TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
      WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
END $mig$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bi_comercial_vendedor TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Gating central (reusado por TODAS as RPCs) → {modo: vendedor|lider|sem_acesso, cod}
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_scope(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_cod text; v_lider boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('modo', 'sem_acesso'); END IF;
  v_lider := public.is_admin() OR EXISTS (
    SELECT 1 FROM tenant_user_roles r
     WHERE r.user_id = v_uid AND r.company_id = p_company_id AND COALESCE(r.is_active, true)
       AND (r.role IN ('CLIENT_OWNER','CLIENT_MANAGER')
            OR r.observacao ILIKE '%diretor_vendas%' OR r.observacao ILIKE '%assistente_vendas%'));
  SELECT cod_vend_comp INTO v_cod FROM bi_comercial_vendedor
    WHERE user_id = v_uid AND company_id = p_company_id LIMIT 1;
  -- líder tem precedência (nunca fica restrito por acaso); depois vendedor mapeado; senão sem acesso.
  IF v_lider THEN RETURN jsonb_build_object('modo', 'lider');
  ELSIF v_cod IS NOT NULL THEN RETURN jsonb_build_object('modo', 'vendedor', 'cod', v_cod);
  ELSE RETURN jsonb_build_object('modo', 'sem_acesso'); END IF;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) KPIs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_kpis(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_vendedor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_vend text; r RECORD; v_lucro_ok boolean;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;  -- vendedor: forçado
  SELECT
    COALESCE(SUM((raw->>'PESO')::numeric), 0)  AS volume_kg,
    COALESCE(SUM((raw->>'VALOR')::numeric), 0) AS faturamento,
    COALESCE(SUM((raw->>'LUCRO')::numeric), 0) AS lucro,
    COUNT(DISTINCT raw->>'COD_CLI_FOR')        AS clientes,
    COUNT(*)                                   AS n,
    COUNT(*) FILTER (WHERE abs((raw->>'LUCRO')::numeric) > (raw->>'VALOR')::numeric) AS n_impl
    INTO r
  FROM ind_atak_fato
  WHERE dominio = 'comercial_vendas' AND company_id = p_company_id
    AND (raw->>'DATA_ESTOQUE')::timestamptz::date BETWEEN p_dt_ini AND p_dt_fim
    AND (v_vend IS NULL OR raw->>'COD_VEND_COMP' = v_vend);
  -- selo de confiabilidade do LUCRO: lucro nunca deveria exceder a receita da linha; se >2% excedem, é lixo de origem.
  v_lucro_ok := (r.n > 0 AND r.n_impl::numeric / r.n < 0.02);
  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', r.clientes,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(r.clientes, 0), 2),
    'lucro', CASE WHEN v_lucro_ok THEN r.lucro ELSE NULL END,
    'margem_pct', CASE WHEN v_lucro_ok THEN ROUND(r.lucro / NULLIF(r.faturamento, 0) * 100, 2) ELSE NULL END,
    'lucro_status', CASE WHEN v_lucro_ok THEN 'ok' ELSE 'aguardando_dado_confiavel' END);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Série temporal (dia/semana/mes/trimestre/ano)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_serie(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_granularidade text DEFAULT 'mes', p_vendedor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_vend text; v_trunc text; v_out jsonb; v_lucro_ok boolean; v_n bigint; v_impl bigint;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  v_trunc := CASE lower(COALESCE(p_granularidade,'mes'))
               WHEN 'dia' THEN 'day' WHEN 'semana' THEN 'week' WHEN 'mes' THEN 'month'
               WHEN 'trimestre' THEN 'quarter' WHEN 'ano' THEN 'year' ELSE 'month' END;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE abs((raw->>'LUCRO')::numeric) > (raw->>'VALOR')::numeric)
    INTO v_n, v_impl
  FROM ind_atak_fato
  WHERE dominio = 'comercial_vendas' AND company_id = p_company_id
    AND (raw->>'DATA_ESTOQUE')::timestamptz::date BETWEEN p_dt_ini AND p_dt_fim
    AND (v_vend IS NULL OR raw->>'COD_VEND_COMP' = v_vend);
  v_lucro_ok := (v_n > 0 AND v_impl::numeric / v_n < 0.02);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'periodo', per, 'volume_kg', vol, 'faturamento', fat,
      'margem_pct', CASE WHEN v_lucro_ok THEN ROUND(luc / NULLIF(fat, 0) * 100, 2) ELSE NULL END) ORDER BY per), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT date_trunc(v_trunc, (raw->>'DATA_ESTOQUE')::timestamptz)::date AS per,
           SUM((raw->>'PESO')::numeric) AS vol, SUM((raw->>'VALOR')::numeric) AS fat, SUM((raw->>'LUCRO')::numeric) AS luc
    FROM ind_atak_fato
    WHERE dominio = 'comercial_vendas' AND company_id = p_company_id
      AND (raw->>'DATA_ESTOQUE')::timestamptz::date BETWEEN p_dt_ini AND p_dt_fim
      AND (v_vend IS NULL OR raw->>'COD_VEND_COMP' = v_vend)
    GROUP BY 1
  ) s;
  RETURN jsonb_build_object('ok', true, 'granularidade', v_trunc, 'serie', v_out,
    'lucro_status', CASE WHEN v_lucro_ok THEN 'ok' ELSE 'aguardando_dado_confiavel' END);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Pareto (cliente/vendedor/supervisor/filial) com % e % acumulado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_pareto(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_dimensao text DEFAULT 'cliente', p_vendedor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_vend text; v_campo text; v_out jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;
  v_campo := CASE lower(COALESCE(p_dimensao,'cliente'))
               WHEN 'cliente' THEN 'NOME_PARTICIPANTE' WHEN 'vendedor' THEN 'NOME_VENDEDOR'
               WHEN 'supervisor' THEN 'NOME_SUPERVISOR' WHEN 'filial' THEN 'COD_FILIAL' ELSE 'NOME_PARTICIPANTE' END;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rotulo', rotulo, 'valor', valor, 'pct', pct, 'pct_acumulado', pct_acum) ORDER BY valor DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT rotulo, valor,
           ROUND(valor / NULLIF(SUM(valor) OVER (), 0) * 100, 2) AS pct,
           ROUND(SUM(valor) OVER (ORDER BY valor DESC ROWS UNBOUNDED PRECEDING) / NULLIF(SUM(valor) OVER (), 0) * 100, 2) AS pct_acum
    FROM (
      SELECT COALESCE(NULLIF(btrim(raw->>v_campo), ''), '(sem)') AS rotulo, SUM((raw->>'VALOR')::numeric) AS valor
      FROM ind_atak_fato
      WHERE dominio = 'comercial_vendas' AND company_id = p_company_id
        AND (raw->>'DATA_ESTOQUE')::timestamptz::date BETWEEN p_dt_ini AND p_dt_fim
        AND (v_vend IS NULL OR raw->>'COD_VEND_COMP' = v_vend)
      GROUP BY 1
    ) g
  ) p;
  RETURN jsonb_build_object('ok', true, 'dimensao', lower(COALESCE(p_dimensao,'cliente')), 'itens', v_out);
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Ranking de vendedores (só líder)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_ranking_vendedores(p_company_id uuid, p_dt_ini date, p_dt_fim date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_scope jsonb; v_out jsonb; v_lucro_ok boolean; v_n bigint; v_impl bigint;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' <> 'lider' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE abs((raw->>'LUCRO')::numeric) > (raw->>'VALOR')::numeric)
    INTO v_n, v_impl
  FROM ind_atak_fato
  WHERE dominio = 'comercial_vendas' AND company_id = p_company_id
    AND (raw->>'DATA_ESTOQUE')::timestamptz::date BETWEEN p_dt_ini AND p_dt_fim;
  v_lucro_ok := (v_n > 0 AND v_impl::numeric / v_n < 0.02);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cod_vend_comp', cod, 'vendedor', nome, 'volume_kg', vol, 'faturamento', fat, 'clientes', cli,
      'lucro', CASE WHEN v_lucro_ok THEN luc ELSE NULL END,
      'margem_pct', CASE WHEN v_lucro_ok THEN ROUND(luc / NULLIF(fat, 0) * 100, 2) ELSE NULL END) ORDER BY fat DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT raw->>'COD_VEND_COMP' AS cod, MAX(raw->>'NOME_VENDEDOR') AS nome,
           SUM((raw->>'PESO')::numeric) AS vol, SUM((raw->>'VALOR')::numeric) AS fat,
           SUM((raw->>'LUCRO')::numeric) AS luc, COUNT(DISTINCT raw->>'COD_CLI_FOR') AS cli
    FROM ind_atak_fato
    WHERE dominio = 'comercial_vendas' AND company_id = p_company_id
      AND (raw->>'DATA_ESTOQUE')::timestamptz::date BETWEEN p_dt_ini AND p_dt_fim
    GROUP BY 1
  ) r;
  RETURN jsonb_build_object('ok', true, 'ranking', v_out,
    'lucro_status', CASE WHEN v_lucro_ok THEN 'ok' ELSE 'aguardando_dado_confiavel' END);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_scope(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_serie(uuid, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_pareto(uuid, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_ranking_vendedores(uuid, date, date) TO authenticated;
