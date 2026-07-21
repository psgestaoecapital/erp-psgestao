-- Fix Visita Técnica: registrar visita a partir do CLIENTE (a oportunidade é resolvida/criada no backend).
-- Reuso (RD-26): erp_clientes (FK), etapa 'prospeccao' (já tratada por fn_crm_visita_salvar), "aberta"=etapa NOT IN (ganho,perdido).
-- Provado autenticado (Lucca, abortado): obter_ou_criar idempotente (não duplica), cria 1 oportunidade (origem='visita'),
-- visita vinculada, etapa→visita_feita ao salvar 'realizada'.
-- Cuidado (negócio): cada visita a cliente sem oportunidade cria 1 no funil (origem='visita' — dá pra filtrar no relatório de conversão).

CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_obter_ou_criar(p_cliente_id uuid, p_titulo text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_comp uuid; v_nome text; v_id uuid;
BEGIN
  SELECT company_id, coalesce(nullif(trim(nome_fantasia),''), nullif(trim(razao_social),''))
    INTO v_comp, v_nome FROM erp_clientes WHERE id = p_cliente_id;
  IF v_comp IS NULL THEN RAISE EXCEPTION 'Cliente nao encontrado'; END IF;
  IF v_comp NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'Sem acesso a esta empresa'; END IF;

  SELECT id INTO v_id FROM erp_crm_oportunidade
   WHERE cliente_id = p_cliente_id AND etapa NOT IN ('ganho','perdido')
   ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO erp_crm_oportunidade (company_id, cliente_id, titulo, etapa, origem)
  VALUES (v_comp, p_cliente_id, coalesce(nullif(trim(p_titulo),''), v_nome, 'Visita'), 'prospeccao', 'visita')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_obter_ou_criar(uuid, text) TO authenticated;

-- fn_crm_visita_salvar: aceita p_cliente_id opcional; sem oportunidade + com cliente → resolve/cria.
-- DROP+CREATE (não overload) — único caller é o modal (named params). Retorna oportunidade_id usado.
DROP FUNCTION IF EXISTS public.fn_crm_visita_salvar(uuid, timestamptz, uuid, text, text, text, numeric, numeric, jsonb, uuid);
CREATE OR REPLACE FUNCTION public.fn_crm_visita_salvar(
  p_oportunidade_id uuid DEFAULT NULL, p_data_visita timestamptz DEFAULT NULL, p_responsavel_id uuid DEFAULT NULL,
  p_status text DEFAULT 'agendada', p_endereco text DEFAULT NULL, p_anotacoes text DEFAULT NULL,
  p_gps_lat numeric DEFAULT NULL, p_gps_lng numeric DEFAULT NULL, p_fotos jsonb DEFAULT '[]'::jsonb,
  p_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_comp uuid; v_etapa text; v_visita_id uuid; v_oport uuid := p_oportunidade_id;
BEGIN
  IF v_oport IS NULL AND p_cliente_id IS NOT NULL THEN
    v_oport := public.fn_crm_oportunidade_obter_ou_criar(p_cliente_id, NULL);
  END IF;
  IF v_oport IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o cliente ou a oportunidade');
  END IF;

  SELECT company_id, etapa INTO v_comp, v_etapa FROM erp_crm_oportunidade WHERE id = v_oport;
  IF v_comp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Oportunidade nao encontrada');
  END IF;
  IF v_comp NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissao para esta empresa');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO erp_crm_visita(company_id, oportunidade_id, data_visita, responsavel_id, status,
                               endereco, anotacoes, gps_lat, gps_lng, fotos)
    VALUES (v_comp, v_oport, p_data_visita, p_responsavel_id, COALESCE(p_status,'agendada'),
            p_endereco, p_anotacoes, p_gps_lat, p_gps_lng, COALESCE(p_fotos,'[]'::jsonb))
    RETURNING id INTO v_visita_id;
  ELSE
    UPDATE erp_crm_visita SET
      data_visita = p_data_visita, responsavel_id = p_responsavel_id,
      status = COALESCE(p_status, status), endereco = p_endereco,
      anotacoes = p_anotacoes, gps_lat = p_gps_lat, gps_lng = p_gps_lng,
      fotos = COALESCE(p_fotos, fotos)
    WHERE id = p_id AND oportunidade_id = v_oport
    RETURNING id INTO v_visita_id;
    IF v_visita_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Visita nao encontrada');
    END IF;
  END IF;

  IF p_status = 'realizada' AND v_etapa IN ('prospeccao','visita_agendada') THEN
    UPDATE erp_crm_oportunidade SET etapa = 'visita_feita', updated_at = now()
    WHERE id = v_oport;
  END IF;

  RETURN jsonb_build_object('ok', true, 'visita_id', v_visita_id, 'oportunidade_id', v_oport);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_crm_visita_salvar(uuid, timestamptz, uuid, text, text, text, numeric, numeric, jsonb, uuid, uuid) TO authenticated;
