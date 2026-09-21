-- Revenda R4c · Configuração da garagem ganha o bloco "Entrega": itens do checklist + texto do termo
--
-- As colunas veic_config.checklist_entrega (jsonb) e termo_entrega_padrao (text) já existem (R4a).
-- Aqui entram as RPCs para ler e gravar esse bloco, por empresa, com guarda de empresa (sem anon).
-- O checklist da entrega NÃO afeta preço mínimo, então tem save próprio (fora da prévia da R2).

CREATE OR REPLACE FUNCTION public.fn_veic_config_entrega_obter(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pad jsonb; v_termo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_pad := fn_veic_checklist_padrao(p_company_id);   -- itens da empresa OU o padrão de fábrica
  SELECT termo_entrega_padrao INTO v_termo FROM veic_config WHERE company_id = p_company_id;
  RETURN jsonb_build_object('ok', true,
    'fonte', COALESCE(v_pad->>'fonte', 'fabrica'),
    'itens', COALESCE(v_pad->'itens', '[]'::jsonb),
    'termo', v_termo);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_veic_config_entrega_salvar(p_company_id uuid, p_itens jsonb, p_termo text DEFAULT NULL, p_user uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_it jsonb; v_norm jsonb := '[]'::jsonb; v_n int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'itens_invalidos'); END IF;
  -- normaliza: cada item tem 'item' (texto não-vazio) e 'obrigatorio' (bool). Ignora linhas vazias.
  FOR v_it IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF COALESCE(btrim(v_it->>'item'), '') <> '' THEN
      v_norm := v_norm || jsonb_build_array(jsonb_build_object(
        'item', btrim(v_it->>'item'),
        'obrigatorio', COALESCE((v_it->>'obrigatorio')::boolean, true)));
      v_n := v_n + 1;
    END IF;
  END LOOP;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'checklist_vazio',
      'mensagem', 'Deixe ao menos um item no checklist de entrega.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM veic_config WHERE company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'configure_garagem_primeiro',
      'mensagem', 'Salve a configuração da garagem antes de personalizar a entrega.'); END IF;
  UPDATE veic_config
     SET checklist_entrega = v_norm,
         termo_entrega_padrao = NULLIF(btrim(p_termo), ''),
         updated_at = now()
   WHERE company_id = p_company_id;
  RETURN jsonb_build_object('ok', true, 'itens', v_n);
END $function$;
