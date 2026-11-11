-- Núcleo · Cadastros › Divisões (/dashboard/cadastros/divisoes) · PDCA aud8claudeps 70/95 (tarefa c137802b)
-- Gap que restava (a main já cobriu Editar, confirmação + Desfazer, RD-95 "?" com as chaves ge.divisoes.*,
-- erro amigável e a origem do dado em system_screens):
--   RD-98 p4 — inativar/reativar uma divisão SEM rastro: a tela fazia UPDATE direto em business_lines.is_active
--   pelo client, sem audit_log e sem checar o resultado (falha de permissão sumia em silêncio).
-- Aqui entra a RPC guardada que faz a troca e grava quem/quando em audit_log_global.
-- ADITIVA, idempotente, não altera dado de cliente. Faixa do code-desenvolvedor-3 (segundos :40), acima da main.

-- 1) Ativar/inativar divisão com guarda por empresa + rastro ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_divisao_definir_ativa(p_id uuid, p_ativo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text; v_antes boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para alterar a divisão'); END IF;
  IF p_ativo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe se a divisão fica ativa ou inativa'); END IF;
  SELECT company_id, name, COALESCE(is_active, true)
    INTO v_company, v_nome, v_antes
    FROM public.business_lines WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Divisão não encontrada'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  -- idempotente: já está no estado pedido → nada a gravar (nem rastro duplicado)
  IF v_antes = p_ativo THEN RETURN jsonb_build_object('ok', true, 'sem_mudanca', true); END IF;
  UPDATE public.business_lines SET is_active = p_ativo WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'business_lines', p_id, CASE WHEN p_ativo THEN 'reativar' ELSE 'inativar' END,
            jsonb_build_object('is_active', v_antes, 'nome', v_nome),
            jsonb_build_object('is_active', p_ativo, 'nome', v_nome, 'em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_divisao_definir_ativa(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_divisao_definir_ativa(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_divisao_definir_ativa(uuid, boolean) TO authenticated, service_role;

-- 2) RD-98 p3 · origem do dado: acrescenta a RPC nova à rota canônica (idempotente, sem duplicar) ─────
UPDATE public.system_screens
   SET rpcs_chamadas = array_append(COALESCE(rpcs_chamadas, ARRAY[]::text[]), 'fn_divisao_definir_ativa')
 WHERE rota = '/dashboard/cadastros/divisoes'
   AND NOT ('fn_divisao_definir_ativa' = ANY (COALESCE(rpcs_chamadas, ARRAY[]::text[])));
