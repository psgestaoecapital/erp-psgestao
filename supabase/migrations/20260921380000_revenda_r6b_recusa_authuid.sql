-- Revenda R6b (fix) · autoria da recusa/reativação por auth.uid() (nunca o p_user do cliente).
-- Aditivo (RD-55, CREATE OR REPLACE). Mantém a assinatura (p_user ignorado, por compatibilidade).

CREATE OR REPLACE FUNCTION public.fn_veic_avaliacao_recusar(p_veiculo_id uuid, p_resposta_id uuid, p_motivo text, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(btrim(p_motivo),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  IF NOT EXISTS (SELECT 1 FROM insp_resposta ir JOIN insp_vistoria iv ON iv.id=ir.vistoria_id
                  WHERE ir.id=p_resposta_id AND iv.alvo_tabela='veic_veiculo' AND iv.alvo_id=p_veiculo_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_pertence_ao_veiculo'); END IF;
  INSERT INTO veic_avaliacao_recusa (company_id, veiculo_id, insp_resposta_id, motivo, ativo, recusado_por)
  VALUES (v_comp, p_veiculo_id, p_resposta_id, btrim(p_motivo), true, auth.uid())
  ON CONFLICT (insp_resposta_id) DO UPDATE SET ativo=true, motivo=btrim(p_motivo),
    recusado_por=auth.uid(), recusado_em=now(), reativado_por=NULL, reativado_em=NULL;
  RETURN jsonb_build_object('ok', true, 'previsao', fn_veic_previsao_vistoria_ajustada(p_veiculo_id),
    'preco_minimo', (fn_veic_preco_minimo(p_veiculo_id))->>'preco_minimo');
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_avaliacao_reativar(p_veiculo_id uuid, p_resposta_id uuid, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid;
BEGIN
  v_comp := fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE veic_avaliacao_recusa SET ativo=false, reativado_por=auth.uid(), reativado_em=now()
   WHERE insp_resposta_id = p_resposta_id AND veiculo_id = p_veiculo_id;
  RETURN jsonb_build_object('ok', true, 'previsao', fn_veic_previsao_vistoria_ajustada(p_veiculo_id),
    'preco_minimo', (fn_veic_preco_minimo(p_veiculo_id))->>'preco_minimo');
END $function$;
