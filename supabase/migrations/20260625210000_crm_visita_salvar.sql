-- fn_crm_visita_salvar: insert/update de visita tecnica.
-- Valida company_id via oportunidade (RLS aplica nas duas tabelas).
-- Se p_status='realizada' e a oportunidade esta em etapa anterior
-- (prospeccao/visita_agendada), avanca pra 'visita_feita'.

CREATE OR REPLACE FUNCTION public.fn_crm_visita_salvar(
  p_id              uuid,
  p_oportunidade_id uuid,
  p_data_visita     timestamptz,
  p_responsavel_id  uuid,
  p_status          text,
  p_endereco        text,
  p_anotacoes       text,
  p_gps_lat         numeric,
  p_gps_lng         numeric,
  p_fotos           jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company uuid;
  v_etapa   text;
  v_visita_id uuid;
BEGIN
  IF p_oportunidade_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'oportunidade obrigatoria');
  END IF;

  SELECT company_id, etapa INTO v_company, v_etapa
  FROM erp_crm_oportunidade
  WHERE id = p_oportunidade_id;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'oportunidade nao encontrada');
  END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem permissao');
  END IF;
  IF p_status NOT IN ('agendada', 'realizada', 'cancelada') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status invalido');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO erp_crm_visita (
      company_id, oportunidade_id, data_visita, responsavel_id, status,
      endereco, anotacoes, gps_lat, gps_lng, fotos
    ) VALUES (
      v_company, p_oportunidade_id, p_data_visita, p_responsavel_id, p_status,
      p_endereco, p_anotacoes, p_gps_lat, p_gps_lng, COALESCE(p_fotos, '[]'::jsonb)
    )
    RETURNING id INTO v_visita_id;
  ELSE
    UPDATE erp_crm_visita SET
      data_visita    = p_data_visita,
      responsavel_id = p_responsavel_id,
      status         = p_status,
      endereco       = p_endereco,
      anotacoes      = p_anotacoes,
      gps_lat        = p_gps_lat,
      gps_lng        = p_gps_lng,
      fotos          = COALESCE(p_fotos, '[]'::jsonb)
    WHERE id = p_id
      AND company_id = v_company
    RETURNING id INTO v_visita_id;

    IF v_visita_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'visita nao encontrada');
    END IF;
  END IF;

  -- Avanca etapa se realizada e a oportunidade ainda esta antes de visita_feita.
  IF p_status = 'realizada' AND v_etapa IN ('prospeccao', 'visita_agendada') THEN
    PERFORM fn_crm_mover_etapa(p_oportunidade_id, 'visita_feita', NULL);
  END IF;

  RETURN jsonb_build_object('ok', true, 'visita_id', v_visita_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_crm_visita_salvar(
  uuid, uuid, timestamptz, uuid, text, text, text, numeric, numeric, jsonb
) TO authenticated;

-- Atualiza feature_catalog: visitas pronta
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES ('crm_visitas_telas', 'projetos_visitas', 'projetos',
        'CRM · Visitas Tecnicas',
        'Tela de lista de visitas + modal compartilhado de registro (camera, GPS, fotos no bucket). Atualiza etapa da oportunidade quando visita e realizada.',
        'pronto', 100, 'alta')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  percentual_pronto = EXCLUDED.percentual_pronto,
  descricao_executiva = EXCLUDED.descricao_executiva;
