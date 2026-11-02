-- RD-98 p4: exclusão de apontamento de mão de obra da obra (/dashboard/projetos/obras/[id]/horas)
-- rastreável também no audit_log_global central.
--
-- A fn_obra_mao_obra_excluir já fazia soft-delete (excluido_em) e registrava o autor (excluido_por),
-- protegida por fn__guarda_empresa. Faltava gravar na TRILHA ÚNICA public.audit_log_global, como as
-- demais exclusões do Hub (fn_crm_visita_excluir, fn_obra_excluir, fn_obra_tarefa_excluir,
-- fn_takeoff_*_excluir) — para a exclusão aparecer no mesmo lugar que todas as outras.
--
-- Aditiva e segura: apenas CREATE OR REPLACE, mesma assinatura e mesmo comportamento; acrescenta um
-- único INSERT no audit_log_global. Nenhum dado de cliente é alterado ou removido; a guarda por
-- empresa (fn__guarda_empresa) e o SECURITY DEFINER/search_path permanecem intactos.
CREATE OR REPLACE FUNCTION public.fn_obra_mao_obra_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_mao_obra_apontamento WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Apontamento não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_mao_obra_apontamento SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  -- RD-98 p4: trilha central de auditoria (mesmo padrão de fn_crm_visita_excluir / fn_obra_tarefa_excluir)
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (v_company, auth.uid(), 'projetos_obra_mao_obra_apontamento', p_id, 'excluir',
            jsonb_build_object('excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- check_fn_guards regra 1: fecha a função ao anon (idempotente; CREATE OR REPLACE reabriria a régua)
REVOKE ALL ON FUNCTION public.fn_obra_mao_obra_excluir(uuid) FROM anon;
