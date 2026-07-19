-- OFICINA LOTE A · FILA POR ETAPA. Diagnóstico/Aprovação/Apontamento listavam as MESMAS 9 OS.
-- Cada tela deve mostrar só o que está PRONTO PRA ELA:
--   diagnostico → todas (marca as que já têm laudo)  ·  aprovacao → só COM laudo  ·  apontamento → só APROVADAS.
-- + permitir informar a placa na hora (OS antiga sem placa aparece como "—" e some do cadastro de veículo).
-- RD-45 escopo company_id. Operacional, sem financeiro.

CREATE OR REPLACE FUNCTION public.fn_oficina_os_fila(p_company_id uuid, p_etapa text DEFAULT 'diagnostico')
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  WITH base AS (
    SELECT o.id, o.numero, o.cliente_nome, o.placa, o.marca, o.modelo, o.status, o.defeito_relatado,
           o.created_at,
           (SELECT count(*) FROM erp_os_diagnostico_item i WHERE i.os_id=o.id) AS qtd_itens,
           (SELECT count(*) FROM erp_os_diagnostico_item i WHERE i.os_id=o.id AND i.tipo='servico' AND i.aprovado IS TRUE) AS qtd_serv_aprov,
           (SELECT count(*) FROM erp_os_diagnostico_item i WHERE i.os_id=o.id AND i.aprovado IS TRUE) AS qtd_aprov,
           (SELECT count(*) FROM erp_os_apontamento a WHERE a.os_id=o.id AND a.status='concluido') AS qtd_apont_ok
    FROM erp_os o
    WHERE o.company_id = p_company_id AND coalesce(o.excluida,false)=false
      AND coalesce(o.status,'') NOT IN ('entregue','cancelada')
      AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'numero', numero, 'cliente_nome', cliente_nome, 'placa', placa,
    'marca', marca, 'modelo', modelo, 'status', status, 'defeito_relatado', defeito_relatado,
    'qtd_itens', qtd_itens, 'qtd_aprovados', qtd_aprov, 'qtd_serv_aprovados', qtd_serv_aprov,
    'apontamentos_ok', qtd_apont_ok, 'tem_laudo', (qtd_itens > 0)
  ) ORDER BY created_at DESC), '[]'::jsonb)
  FROM base b
  WHERE CASE p_etapa
    WHEN 'aprovacao'   THEN b.qtd_itens > 0        -- só com laudo
    WHEN 'apontamento' THEN b.qtd_serv_aprov > 0   -- só com serviço aprovado
    ELSE true                                       -- diagnostico: todas (marca as com laudo)
  END;
$$;

-- informar/corrigir a placa direto da fila (normaliza igual fn_os_criar). Operacional.
CREATE OR REPLACE FUNCTION public.fn_oficina_os_set_placa(p_company_id uuid, p_os_id uuid, p_placa text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_norm text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  v_norm := upper(regexp_replace(coalesce(p_placa,''), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_norm) < 5 THEN RETURN jsonb_build_object('ok', false, 'erro', 'placa inválida'); END IF;
  UPDATE erp_os SET placa = v_norm, updated_at = now()
    WHERE id = p_os_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  RETURN jsonb_build_object('ok', true, 'placa', v_norm);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_os_fila(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_os_set_placa(uuid, uuid, text) TO authenticated;
