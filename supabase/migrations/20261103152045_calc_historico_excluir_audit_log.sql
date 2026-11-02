-- RD-98 p4: exclusão de cálculo salvo (histórico da Calculadora de Obra, /dashboard/projetos/calculadora)
-- rastreável no audit_log_global central.
--
-- A fn_calc_historico_excluir já fazia soft-delete (excluido_em) e registrava o autor (excluido_por),
-- protegida por fn__guarda_empresa. Faltava gravar na TRILHA ÚNICA public.audit_log_global, como as
-- demais exclusões do Hub.
--
-- Aditiva e segura: apenas CREATE OR REPLACE, mesma assinatura e mesmo comportamento; acrescenta um
-- único INSERT no audit_log_global. Guarda por empresa e SECURITY DEFINER/search_path intactos.
CREATE OR REPLACE FUNCTION public.fn_calc_historico_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.erp_calc_historico%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO v FROM public.erp_calc_historico WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cálculo não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  UPDATE public.erp_calc_historico SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  -- RD-98 p4: trilha central de auditoria (mesmo padrão de fn_crm_visita_excluir)
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (v.company_id, auth.uid(), 'erp_calc_historico', p_id, 'excluir',
            jsonb_build_object('excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- check_fn_guards regra 1: fecha a função ao anon (idempotente; CREATE OR REPLACE reabriria a régua)
REVOKE ALL ON FUNCTION public.fn_calc_historico_excluir(uuid) FROM anon;
