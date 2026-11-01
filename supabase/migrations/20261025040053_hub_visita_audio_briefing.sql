-- Hub · Visitas (lane comercial): grava o áudio do briefing da visita. A coluna erp_crm_visita.audio_briefing_url já
-- existe, mas fn_crm_visita_salvar não a recebia. Troca a assinatura (novo parâmetro p_audio_briefing_url, por último,
-- DEFAULT NULL) mantendo o corpo; NULL em edição preserva o áudio já gravado (a remoção usa p_audio_remover := true).
-- Também acrescenta o "?" do campo (RD-95).
DROP FUNCTION IF EXISTS public.fn_crm_visita_salvar(uuid, timestamptz, uuid, text, text, text, numeric, numeric, jsonb, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.fn_crm_visita_salvar(
  p_oportunidade_id uuid DEFAULT NULL::uuid, p_data_visita timestamptz DEFAULT NULL::timestamptz,
  p_responsavel_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'agendada'::text, p_endereco text DEFAULT NULL::text,
  p_anotacoes text DEFAULT NULL::text, p_gps_lat numeric DEFAULT NULL::numeric, p_gps_lng numeric DEFAULT NULL::numeric,
  p_fotos jsonb DEFAULT '[]'::jsonb, p_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid,
  p_responsavel_nome text DEFAULT NULL::text, p_audio_briefing_url text DEFAULT NULL::text,
  p_audio_remover boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_etapa text; v_visita_id uuid; v_oport uuid := p_oportunidade_id;
  v_resp_nome text := CASE WHEN p_responsavel_id IS NOT NULL THEN NULL ELSE NULLIF(btrim(p_responsavel_nome), '') END;
  v_audio text := NULLIF(btrim(p_audio_briefing_url), '');
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
    INSERT INTO erp_crm_visita(company_id, oportunidade_id, data_visita, responsavel_id, responsavel_nome, status,
                               endereco, anotacoes, gps_lat, gps_lng, fotos, audio_briefing_url)
    VALUES (v_comp, v_oport, p_data_visita, p_responsavel_id, v_resp_nome, COALESCE(p_status,'agendada'),
            p_endereco, p_anotacoes, p_gps_lat, p_gps_lng, COALESCE(p_fotos,'[]'::jsonb), v_audio)
    RETURNING id INTO v_visita_id;
  ELSE
    UPDATE erp_crm_visita SET
      data_visita = p_data_visita, responsavel_id = p_responsavel_id, responsavel_nome = v_resp_nome,
      status = COALESCE(p_status, status), endereco = p_endereco,
      anotacoes = p_anotacoes, gps_lat = p_gps_lat, gps_lng = p_gps_lng,
      fotos = COALESCE(p_fotos, fotos),
      audio_briefing_url = CASE WHEN COALESCE(p_audio_remover, false) THEN NULL ELSE COALESCE(v_audio, audio_briefing_url) END
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
END $function$;

REVOKE ALL ON FUNCTION public.fn_crm_visita_salvar(uuid, timestamptz, uuid, text, text, text, numeric, numeric, jsonb, uuid, uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_visita_salvar(uuid, timestamptz, uuid, text, text, text, numeric, numeric, jsonb, uuid, uuid, text, text, boolean) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'projetos.visitas.audio_briefing', 'Visitas técnicas', 'Áudio do briefing',
  'Grave ou anexe um áudio curto contando o que o cliente pediu e o que você viu na obra.',
  'Fica guardado na visita para quem for orçar ouvir o contexto, sem depender da memória do vendedor.',
  'Áudio de 1 minuto: "cliente quer piso de uretano no galpão, uns 300 m², entrega em março".',
  'Gravar áudio longo demais ou em lugar com muito barulho: ninguém consegue ouvir depois.',
  19, '/dashboard/projetos/visitas', 'hub_construcao', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
