-- Revenda R0.4 · Chamado #49 (Alliance): "campo detalhes — ainda consta potência e cv, não alterou"
--
-- CAUSA (RD-38): fn_veic_atualizar_dados usava COALESCE(NULLIF(x,'')::tipo, atual) em TODOS os campos.
-- NULLIF(x,'') transforma um campo ESVAZIADO em NULL, e o COALESCE então MANTÉM o valor antigo — ou seja,
-- era IMPOSSÍVEL apagar/limpar potência, cilindradas, combustível etc.: o operador limpava/corrigia um valor
-- errado (ex.: importado 500cv numa moto) e o campo "não alterava". (Trocar por um valor novo funcionava; só
-- limpar/zerar não.)
--
-- Correção: a CHAVE PRESENTE no payload passa a ser AUTORITATIVA — presente e vazia → grava NULL (limpa);
-- presente com valor → grava o valor; AUSENTE → mantém o atual. marca/modelo (NOT NULL) seguem protegidos
-- contra blank (nunca viram vazio). O formulário de edição só manda os campos que edita, então os demais
-- ficam intactos.

CREATE OR REPLACE FUNCTION public.fn_veic_atualizar_dados(p_veiculo_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE veic_veiculo SET
    -- identidade NOT NULL: nunca blanqueia (só troca por valor não-vazio)
    marca          = COALESCE(NULLIF(btrim(p_dados->>'marca'),''), marca),
    modelo         = COALESCE(NULLIF(btrim(p_dados->>'modelo'),''), modelo),
    -- demais campos: chave presente é autoritativa (presente+vazio → NULL/limpa; ausente → mantém)
    versao         = CASE WHEN p_dados ? 'versao'          THEN NULLIF(btrim(p_dados->>'versao'),'')          ELSE versao END,
    cor            = CASE WHEN p_dados ? 'cor'             THEN NULLIF(btrim(p_dados->>'cor'),'')             ELSE cor END,
    combustivel    = CASE WHEN p_dados ? 'combustivel'     THEN NULLIF(btrim(p_dados->>'combustivel'),'')     ELSE combustivel END,
    placa          = CASE WHEN p_dados ? 'placa'           THEN NULLIF(btrim(p_dados->>'placa'),'')           ELSE placa END,
    renavam        = CASE WHEN p_dados ? 'renavam'         THEN NULLIF(btrim(p_dados->>'renavam'),'')         ELSE renavam END,
    cambio         = CASE WHEN p_dados ? 'cambio'          THEN NULLIF(btrim(p_dados->>'cambio'),'')          ELSE cambio END,
    potencia_cv    = CASE WHEN p_dados ? 'potencia_cv'     THEN NULLIF(p_dados->>'potencia_cv','')::numeric    ELSE potencia_cv END,
    cilindradas    = CASE WHEN p_dados ? 'cilindradas'     THEN NULLIF(p_dados->>'cilindradas','')::numeric    ELSE cilindradas END,
    portas         = CASE WHEN p_dados ? 'portas'          THEN NULLIF(p_dados->>'portas','')::int             ELSE portas END,
    ano_fabricacao = CASE WHEN p_dados ? 'ano_fabricacao'  THEN NULLIF(p_dados->>'ano_fabricacao','')::int     ELSE ano_fabricacao END,
    ano_modelo     = CASE WHEN p_dados ? 'ano_modelo'      THEN NULLIF(p_dados->>'ano_modelo','')::int         ELSE ano_modelo END,
    km_entrada     = CASE WHEN p_dados ? 'km_entrada'      THEN NULLIF(p_dados->>'km_entrada','')::numeric     ELSE km_entrada END,
    valor_aquisicao= CASE WHEN p_dados ? 'valor_aquisicao' THEN NULLIF(p_dados->>'valor_aquisicao','')::numeric ELSE valor_aquisicao END,
    updated_by = p_user, updated_at = now()
  WHERE id = p_veiculo_id;

  INSERT INTO veic_veiculo_evento(company_id, veiculo_id, tipo, descricao, usuario_id, payload)
  VALUES (v_company, p_veiculo_id, 'edicao', 'Dados do veículo atualizados', p_user,
          jsonb_build_object('campos', (SELECT array_agg(k) FROM jsonb_object_keys(p_dados) k)));

  RETURN jsonb_build_object('ok', true);
END $function$;
