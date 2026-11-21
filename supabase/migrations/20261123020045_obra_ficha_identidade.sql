-- Hub · Gestão de Obras · Ficha da obra — identidade (blueprint vivo tela 314, continuação da classificação)
-- Requisito "parcial" da tela 314: "Ficha da obra: nome, endereço e ponto no mapa, matrícula, inscrição
-- imobiliária, tipo (residencial, comercial, industrial, misto), área construída, área do terreno...".
-- Nome/endereço já existem; esta fatia acrescenta matrícula, inscrição imobiliária, tipo de edificação e
-- as áreas construída e do terreno, na mesma página /dashboard/projetos/obras/[id]/ficha.
-- Depende da migration 20261123013145 (classificação, já na main): esta tem versão maior e aplica depois.
-- Aditiva e idempotente: ADD COLUMN IF NOT EXISTS (colunas distintas da anterior) + CREATE OR REPLACE da
-- leitura (passa a devolver também estes campos — aditivo ao JSON) + função NOVA de gravação. Sem CHECK na
-- tabela (valida na RPC). RLS da projetos_obras já cobre as colunas novas. Não toca dado de cliente.

ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS matricula            text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS inscricao_imobiliaria text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS tipo_edificacao      text;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS area_construida_m2   numeric;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS area_terreno_m2      numeric;

COMMENT ON COLUMN public.projetos_obras.tipo_edificacao    IS 'Tipo da edificação: ''residencial'' | ''comercial'' | ''industrial'' | ''misto''. NULL = não informado.';
COMMENT ON COLUMN public.projetos_obras.area_construida_m2 IS 'Área construída da obra, em m². NULL = não informada.';
COMMENT ON COLUMN public.projetos_obras.area_terreno_m2    IS 'Área do terreno da obra, em m². NULL = não informada.';

-- Leitura da ficha — agora devolve também matrícula/inscrição/tipo/áreas (aditivo ao JSON existente)
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_ler(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.projetos_obras%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'obra_id', v.id,
    'numero', v.numero,
    'nome', v.nome,
    'cliente_nome', v.cliente_nome,
    'tipo_execucao', v.tipo_execucao,
    'modelo_contratacao', v.modelo_contratacao,
    'matricula', v.matricula,
    'inscricao_imobiliaria', v.inscricao_imobiliaria,
    'tipo_edificacao', v.tipo_edificacao,
    'area_construida_m2', v.area_construida_m2,
    'area_terreno_m2', v.area_terreno_m2
  );
END; $function$;

-- Gravação da identidade da obra (separada da classificação, para não mudar a assinatura da fn_obra_ficha_salvar)
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_identidade_salvar(
  p_obra_id uuid, p_matricula text, p_inscricao_imobiliaria text,
  p_tipo_edificacao text, p_area_construida_m2 numeric, p_area_terreno_m2 numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.projetos_obras%ROWTYPE;
  v_mat  text := nullif(btrim(p_matricula), '');
  v_insc text := nullif(btrim(p_inscricao_imobiliaria), '');
  v_tipo text := nullif(btrim(p_tipo_edificacao), '');
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('residencial', 'comercial', 'industrial', 'misto') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Tipo de edificação inválido.');
  END IF;
  IF p_area_construida_m2 IS NOT NULL AND p_area_construida_m2 < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Área construída não pode ser negativa.');
  END IF;
  IF p_area_terreno_m2 IS NOT NULL AND p_area_terreno_m2 < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Área do terreno não pode ser negativa.');
  END IF;

  UPDATE public.projetos_obras
     SET matricula = v_mat, inscricao_imobiliaria = v_insc, tipo_edificacao = v_tipo,
         area_construida_m2 = p_area_construida_m2, area_terreno_m2 = p_area_terreno_m2, updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_identidade',
          jsonb_build_object('matricula', v.matricula, 'inscricao_imobiliaria', v.inscricao_imobiliaria, 'tipo_edificacao', v.tipo_edificacao, 'area_construida_m2', v.area_construida_m2, 'area_terreno_m2', v.area_terreno_m2),
          jsonb_build_object('matricula', v_mat, 'inscricao_imobiliaria', v_insc, 'tipo_edificacao', v_tipo, 'area_construida_m2', p_area_construida_m2, 'area_terreno_m2', p_area_terreno_m2));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_obra_ficha_ler(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_ficha_identidade_salvar(uuid, text, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_ler(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_identidade_salvar(uuid, text, text, text, numeric, numeric) TO authenticated, service_role;

-- RD-95: "?" dos campos e ação novos
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('projetos.obra_ficha.matricula',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Matrícula do imóvel',
  'Número da matrícula do imóvel no Cartório de Registro de Imóveis.',
  'Identifica juridicamente o terreno/imóvel da obra; usado em contratos, financiamento e regularização.',
  'Matrícula 12.345 do 2º Ofício de Registro de Imóveis.',
  'Confundir matrícula (registro do imóvel) com a inscrição imobiliária (cadastro na prefeitura) — são coisas diferentes.',
  'hub_projetos', 4, 1, 'publicado'),
 ('projetos.obra_ficha.inscricao_imobiliaria',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Inscrição imobiliária',
  'Número da inscrição imobiliária (cadastro do imóvel na prefeitura, base do IPTU).',
  'Vincula a obra ao cadastro municipal do imóvel; usado em taxas, alvará e habite-se.',
  'Inscrição 01.02.003.0045 no cadastro da prefeitura.',
  'Deixar em branco quando a obra depende de regularização municipal — informe assim que tiver o número.',
  'hub_projetos', 5, 1, 'publicado'),
 ('projetos.obra_ficha.tipo_edificacao',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Tipo de edificação',
  'Escolha o uso principal da edificação: residencial, comercial, industrial ou misto.',
  'Classifica a obra por uso — orienta índices, impostos e o tipo de projeto/execução.',
  'Prédio de apartamentos → Residencial. Galpão de fábrica → Industrial. Loja no térreo com apartamentos acima → Misto.',
  'Marcar "Residencial" numa obra que tem comércio no térreo — nesse caso é Misto.',
  'hub_projetos', 6, 1, 'publicado'),
 ('projetos.obra_ficha.area_construida',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Área construída (m²)',
  'Informe a área construída total da obra, em metros quadrados.',
  'Base para o custo por m² e para a comparação com o CUB; alimenta indicadores do orçamento.',
  '1.250 (para 1.250 m² de área construída).',
  'Informar a área do terreno no lugar da construída — são campos diferentes.',
  'hub_projetos', 7, 1, 'publicado'),
 ('projetos.obra_ficha.area_terreno',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Área do terreno (m²)',
  'Informe a área do terreno (lote) da obra, em metros quadrados.',
  'Usada em índices de aproveitamento, taxa de ocupação e análise de viabilidade.',
  '600 (para um terreno de 600 m²).',
  'Confundir com a área construída — o terreno é o lote; a construída é o que se edifica.',
  'hub_projetos', 8, 1, 'publicado'),
 ('projetos.obra_ficha.salvar_identidade',
  '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Salvar identidade',
  'Clique para gravar matrícula, inscrição imobiliária, tipo de edificação e as áreas.',
  'Guarda os dados de identidade do imóvel na ficha da obra.',
  'Depois de preencher os campos de identidade, clique em Salvar.',
  'Sair da tela sem salvar — os dados de identidade só valem depois de gravar.',
  'hub_projetos', 9, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
