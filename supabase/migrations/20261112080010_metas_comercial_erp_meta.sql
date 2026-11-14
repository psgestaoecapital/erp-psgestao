-- Metas do painel comercial v7 (SPEC §2.8) sobre a tabela erp_meta JÁ EXISTENTE (tabela genérica de metas:
-- indicador + escopo + período). Não cria tabela nova (aditivo): usa indicador 'comercial.faturamento',
-- escopo 'vendedor' (cod do vendedor), período 'mes' (periodo_ref 'AAAA-MM').
--
-- 1) SEGURANÇA: erp_meta tinha TRUNCATE/DELETE para anon e authenticated. A RLS filtra linhas, mas NÃO bloqueia
--    TRUNCATE: qualquer conta com acesso à API podia esvaziar a tabela inteira. Retira o acesso de anon e o
--    TRUNCATE de authenticated. INSERT/UPDATE/DELETE/SELECT de authenticated ficam (a RLS por empresa continua).
-- 2) RPCs (SECURITY DEFINER, guarda de empresa, escopo do BI):
--    - fn_meta_comercial_listar: líder vê todas as metas da empresa do mês; vendedor vê só a própria.
--    - fn_meta_comercial_salvar: só líder grava (upsert por vendedor e mês). Fail-closed: sem escopo, recusa.

REVOKE ALL ON public.erp_meta FROM anon;
REVOKE TRUNCATE ON public.erp_meta FROM authenticated;

CREATE OR REPLACE FUNCTION public.fn_meta_comercial_listar(p_company_id uuid, p_mes text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_scope jsonb; v_out jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_mes IS NULL OR p_mes !~ '^\d{4}-\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mes_invalido');
  END IF;
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' IS NULL OR v_scope->>'modo' = 'sem_acesso' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'vendedor_cod', m.escopo_valor, 'valor', m.valor_meta, 'atualizado_em', m.atualizado_em)
         ORDER BY m.escopo_valor), '[]'::jsonb)
    INTO v_out
    FROM public.erp_meta m
   WHERE m.company_id = p_company_id
     AND m.indicador_id = 'comercial.faturamento' AND m.escopo_tipo = 'vendedor'
     AND m.periodo_tipo = 'mes' AND m.periodo_ref = p_mes AND m.ativo
     AND (v_scope->>'modo' = 'lider' OR m.escopo_valor = v_scope->>'cod');
  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'metas', v_out);
END
$fn$;

CREATE OR REPLACE FUNCTION public.fn_meta_comercial_salvar(p_company_id uuid, p_mes text, p_vendedor text, p_valor numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_scope jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF p_mes IS NULL OR p_mes !~ '^\d{4}-\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'mes_invalido');
  END IF;
  IF p_vendedor IS NULL OR btrim(p_vendedor) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vendedor_obrigatorio');
  END IF;
  IF p_valor IS NULL OR p_valor < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor_invalido');
  END IF;
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' IS DISTINCT FROM 'lider' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_lider_grava_meta');
  END IF;
  INSERT INTO public.erp_meta (company_id, indicador_id, escopo_tipo, escopo_valor, periodo_tipo, periodo_ref,
                               valor_meta, fonte, ativo, criado_por, criado_em, atualizado_em)
  VALUES (p_company_id, 'comercial.faturamento', 'vendedor', btrim(p_vendedor), 'mes', p_mes,
          p_valor, 'painel_comercial_v7', true, auth.uid(), now(), now())
  ON CONFLICT (company_id, indicador_id, escopo_tipo, escopo_valor, periodo_tipo, periodo_ref)
  DO UPDATE SET valor_meta = EXCLUDED.valor_meta, ativo = true, atualizado_em = now();
  RETURN jsonb_build_object('ok', true, 'vendedor_cod', btrim(p_vendedor), 'mes', p_mes, 'valor', p_valor);
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_meta_comercial_listar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_meta_comercial_salvar(uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_meta_comercial_listar(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_meta_comercial_salvar(uuid, text, text, numeric) TO authenticated, service_role;
