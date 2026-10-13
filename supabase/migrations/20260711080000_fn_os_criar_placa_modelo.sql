-- ============================================================
-- FIX: dobrar placa/modelo no fn_os_criar (atômico) — remove o update
-- pós-insert no cliente que quebrava o fluxo de save da OS.
-- Novos params OPCIONAIS no fim da assinatura (não quebra chamadas existentes).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_os_criar(
  p_company_id uuid, p_descricao_servico text,
  p_cliente_id uuid DEFAULT NULL, p_cliente_nome varchar DEFAULT NULL, p_cliente_cnpj varchar DEFAULT NULL,
  p_equipamento varchar DEFAULT NULL, p_defeito_relatado text DEFAULT NULL,
  p_tecnico_id uuid DEFAULT NULL, p_tecnico_nome varchar DEFAULT NULL, p_prioridade varchar DEFAULT 'normal',
  p_placa varchar DEFAULT NULL, p_modelo varchar DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    placa, modelo,
    status, data_abertura, created_by
  ) VALUES (
    p_company_id, v_numero,
    COALESCE(NULLIF(btrim(p_descricao_servico),''), 'Ordem de servico'),
    p_cliente_id, p_cliente_nome, p_cliente_cnpj,
    p_equipamento, p_defeito_relatado,
    p_tecnico_id, p_tecnico_nome, COALESCE(NULLIF(p_prioridade,''),'normal'),
    NULLIF(upper(regexp_replace(COALESCE(p_placa,''), '[^A-Za-z0-9]', '', 'g')), ''),
    NULLIF(btrim(COALESCE(p_modelo,'')), ''),
    'aberta', CURRENT_DATE, auth.uid()
  ) RETURNING * INTO v_os;

  RETURN jsonb_build_object('ok', true, 'ja_existia', false,
    'os_id', v_os.id, 'numero', v_os.numero, 'status', v_os.status);
END; $function$;
