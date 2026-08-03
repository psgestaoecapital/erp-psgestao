-- RD-41 · Oficina — avisar (não bloquear) 2ª OS pra placa que já tem OS aberta.
-- Raiz (RD-38): fn_os_criar não checa OS aberta pra a mesma placa → duplicou (JVU0D25:
-- OS-2026-0026 + OS-2026-0027). Fix ADITIVO (RD-26): função de consulta que o front chama
-- ANTES de criar; se houver OS não-finalizada pra aquela placa, a tela avisa e deixa decidir
-- (abrir a existente ou criar nova mesmo assim). fn_os_criar fica intacta.
-- Genérico: placa opcional (retífica não tem) → sem placa, retorna existe=false (não trava).

CREATE OR REPLACE FUNCTION public.fn_os_placa_aberta(p_company_id uuid, p_placa text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_placa text; v RECORD;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  -- normaliza igual ao fn_os_criar (maiúsculas, sem separadores)
  v_placa := NULLIF(upper(regexp_replace(coalesce(p_placa,''), '[^A-Za-z0-9]', '', 'g')), '');
  IF v_placa IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'existe', false);
  END IF;

  SELECT id, numero, status, data_abertura INTO v
    FROM erp_os
   WHERE company_id = p_company_id
     AND placa = v_placa
     AND excluida_em IS NULL
     AND status NOT IN ('entregue', 'cancelada')   -- "não-finalizada"
   ORDER BY data_abertura DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'existe', false);
  END IF;

  RETURN jsonb_build_object('ok', true, 'existe', true,
    'id', v.id, 'numero', v.numero, 'status', v.status, 'data_abertura', v.data_abertura);
END $function$;

REVOKE ALL ON FUNCTION public.fn_os_placa_aberta(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_os_placa_aberta(uuid, text) TO authenticated;
