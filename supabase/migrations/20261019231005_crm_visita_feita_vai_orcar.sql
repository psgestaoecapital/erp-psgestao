-- Chamado #3268 (Tryo, HB2): "Visita feita" leva a oportunidade sozinha para a fila do orçamento (etapa Orçando).
-- RD-97: ADITIVA e DESLIGADA por padrão. Só quem liga a opção na empresa muda de comportamento; as demais seguem como hoje.
-- Plano de volta: desligar a opção na tela (ou UPDATE da coluna para false); DROP COLUMN seguro, ninguém mais a lê.
-- Obs.: validade_dias deixa de ser NOT NULL para a linha da empresa poder existir só com esta opção (CHECK 1–365 continua valendo).

ALTER TABLE public.orcamento_config_empresa ALTER COLUMN validade_dias DROP NOT NULL;
ALTER TABLE public.orcamento_config_empresa ADD COLUMN IF NOT EXISTS visita_feita_vai_orcar boolean NOT NULL DEFAULT false;

-- Definição VIVA de fn_crm_visita_salvar (pg_get_functiondef em 19/10) + um bloco: com a opção ligada na empresa,
-- a oportunidade que acabou de ir para 'visita_feita' segue direto para 'orcando'.
CREATE OR REPLACE FUNCTION public.fn_crm_visita_salvar(p_oportunidade_id uuid DEFAULT NULL::uuid, p_data_visita timestamp with time zone DEFAULT NULL::timestamp with time zone, p_responsavel_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'agendada'::text, p_endereco text DEFAULT NULL::text, p_anotacoes text DEFAULT NULL::text, p_gps_lat numeric DEFAULT NULL::numeric, p_gps_lng numeric DEFAULT NULL::numeric, p_fotos jsonb DEFAULT '[]'::jsonb, p_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_responsavel_nome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_etapa text; v_visita_id uuid; v_oport uuid := p_oportunidade_id;
  v_resp_nome text := CASE WHEN p_responsavel_id IS NOT NULL THEN NULL ELSE NULLIF(btrim(p_responsavel_nome), '') END;
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
                               endereco, anotacoes, gps_lat, gps_lng, fotos)
    VALUES (v_comp, v_oport, p_data_visita, p_responsavel_id, v_resp_nome, COALESCE(p_status,'agendada'),
            p_endereco, p_anotacoes, p_gps_lat, p_gps_lng, COALESCE(p_fotos,'[]'::jsonb))
    RETURNING id INTO v_visita_id;
  ELSE
    UPDATE erp_crm_visita SET
      data_visita = p_data_visita, responsavel_id = p_responsavel_id, responsavel_nome = v_resp_nome,
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
    UPDATE erp_crm_oportunidade SET
      etapa = CASE WHEN EXISTS (SELECT 1 FROM orcamento_config_empresa c
                                WHERE c.company_id = v_comp AND c.visita_feita_vai_orcar)
                   THEN 'orcando' ELSE 'visita_feita' END,
      updated_at = now()
    WHERE id = v_oport;
  END IF;

  RETURN jsonb_build_object('ok', true, 'visita_id', v_visita_id, 'oportunidade_id', v_oport);
END $function$;

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status)
VALUES
 ('projetos.oportunidades.visita_feita_vai_orcar', '/dashboard/projetos/oportunidades', 'Funil', 'Visita feita vai para Orçando',
  'Marque para que, ao registrar a visita como realizada, a oportunidade já vá para a etapa Orçando. Desmarcado: ela para em Visita feita, como sempre.',
  'Entrega o trabalho ao orçamentista sem ninguém precisar arrastar o cartão depois da visita.',
  'Visita registrada como realizada na terça → a oportunidade já aparece em Orçando.',
  'Esperar que mude as oportunidades que já estão em Visita feita: só vale para as próximas visitas.',
  'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
