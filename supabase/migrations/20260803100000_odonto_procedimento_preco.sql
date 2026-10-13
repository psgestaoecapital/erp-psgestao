-- RD-41 · Odonto O2 — definir o preço padrão de um procedimento (resolve a raiz da O0).
-- Os 6 procedimentos da Felicita têm valor=0 → aprovar plano gera 0 títulos ("plano sem valor").
-- Esta RPC deixa o dentista salvar o preço padrão na hora, no fluxo do plano (sem tela separada).
-- Company-scoped (RLS). Aditivo. RD-51: não finge valor — o dentista define explicitamente.

CREATE OR REPLACE FUNCTION public.fn_odonto_procedimento_preco_definir(
  p_company_id uuid, p_procedimento_id uuid, p_valor numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN json_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF COALESCE(p_valor, -1) < 0 THEN
    RETURN json_build_object('ok', false, 'erro', 'valor inválido');
  END IF;
  UPDATE erp_odonto_procedimento
    SET valor = p_valor
  WHERE id = p_procedimento_id AND company_id = p_company_id
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'erro', 'procedimento não encontrado nesta clínica');
  END IF;
  RETURN json_build_object('ok', true, 'id', v_id, 'valor', p_valor);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_odonto_procedimento_preco_definir(uuid, uuid, numeric) TO authenticated;
