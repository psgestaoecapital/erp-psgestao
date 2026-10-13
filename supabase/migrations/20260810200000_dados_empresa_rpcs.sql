-- Dados da Empresa (cadastral) — 2 RPCs que leem/gravam SÓ campos cadastrais (nunca segredos de integração
-- omie_*/nibo_*/contaazul_* que vivem no mesmo registro companies). Gate get_user_company_ids(). Aditivo.
CREATE OR REPLACE FUNCTION public.fn_empresa_obter_dados(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  SELECT jsonb_build_object(
    'sucesso', true, 'id', id,
    'razao_social', razao_social, 'nome_fantasia', nome_fantasia, 'cnpj', cnpj,
    'inscricao_estadual', inscricao_estadual, 'inscricao_municipal', inscricao_municipal,
    'cidade_estado', cidade_estado, 'endereco', endereco, 'cnae', cnae,
    'regime_tributario', regime_tributario, 'logo_url', logo_url
  ) INTO v FROM public.companies WHERE id = p_company_id;
  RETURN COALESCE(v, jsonb_build_object('sucesso', false, 'erro', 'nao_encontrada'));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_empresa_salvar_dados(
  p_company_id uuid, p_razao_social text, p_nome_fantasia text, p_cnpj text,
  p_inscricao_estadual text, p_inscricao_municipal text, p_cidade_estado text,
  p_endereco text, p_cnae text, p_regime_tributario text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_razao text;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  v_razao := NULLIF(btrim(p_razao_social), '');
  IF v_razao IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'razao_obrigatoria', 'mensagem', 'Razão social é obrigatória.');
  END IF;
  UPDATE public.companies SET
    razao_social = v_razao,
    nome_fantasia = NULLIF(btrim(p_nome_fantasia), ''),
    cnpj = NULLIF(regexp_replace(COALESCE(p_cnpj,''), '\D', '', 'g'), ''),
    inscricao_estadual = NULLIF(btrim(p_inscricao_estadual), ''),
    inscricao_municipal = NULLIF(btrim(p_inscricao_municipal), ''),
    cidade_estado = NULLIF(btrim(p_cidade_estado), ''),
    endereco = NULLIF(btrim(p_endereco), ''),
    cnae = NULLIF(btrim(p_cnae), ''),
    regime_tributario = NULLIF(btrim(p_regime_tributario), ''),
    updated_at = now()
  WHERE id = p_company_id;
  RETURN jsonb_build_object('sucesso', true, 'mensagem', 'Dados da empresa salvos.');
END $function$;
