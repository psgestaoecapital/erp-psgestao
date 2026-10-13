-- =============================================================
-- ONDA-OS-MECANICO-MOBILE-v1 · fn_os_criar
-- =============================================================
-- Cria OS SEM precisar de pedido (o que faltava no fluxo do mecanico
-- mobile). Reusa next_os_numero(). Campos genericos: equipamento=veiculo,
-- tecnico=mecanico. Retorno espelha fn_os_criar_de_pedido
-- (os_id/numero/status) → frontend reusa o handler do PR #307.
--
-- Pilar 2: so cria OS em empresa que o usuario tem acesso
-- (mesma fonte do RLS via user_company_ids()).
--
-- Aplicada via MCP em 2026-06-13.
-- =============================================================

CREATE OR REPLACE FUNCTION public.fn_os_criar(
  p_company_id uuid,
  p_descricao_servico text,
  p_cliente_id uuid DEFAULT NULL,
  p_cliente_nome varchar DEFAULT NULL,
  p_cliente_cnpj varchar DEFAULT NULL,
  p_equipamento varchar DEFAULT NULL,
  p_defeito_relatado text DEFAULT NULL,
  p_tecnico_id uuid DEFAULT NULL,
  p_tecnico_nome varchar DEFAULT NULL,
  p_prioridade varchar DEFAULT 'normal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_os erp_os%ROWTYPE;
  v_numero varchar;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Empresa nao informada');
  END IF;

  IF p_company_id NOT IN (SELECT user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;

  v_numero := next_os_numero(p_company_id);

  INSERT INTO erp_os (
    company_id, numero, descricao_servico,
    cliente_id, cliente_nome, cliente_cnpj,
    equipamento, defeito_relatado,
    tecnico_id, tecnico_nome, prioridade,
    status, data_abertura, created_by
  ) VALUES (
    p_company_id, v_numero,
    COALESCE(NULLIF(btrim(p_descricao_servico),''), 'Ordem de servico'),
    p_cliente_id, p_cliente_nome, p_cliente_cnpj,
    p_equipamento, p_defeito_relatado,
    p_tecnico_id, p_tecnico_nome, COALESCE(NULLIF(p_prioridade,''),'normal'),
    'aberta', CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false,
    'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
END; $function$;

GRANT EXECUTE ON FUNCTION
  public.fn_os_criar(uuid,text,uuid,varchar,varchar,varchar,text,uuid,varchar,varchar)
  TO authenticated;
