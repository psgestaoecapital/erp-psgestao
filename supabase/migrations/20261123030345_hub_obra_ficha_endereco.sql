-- Hub · Gestão de Obras · Ficha da obra — ENDEREÇO da obra (blueprint vivo tela 314,
-- "obra como cadastro central": requisito "Ficha da obra: nome, ENDEREÇO e ponto no mapa,
-- matrícula, inscrição imobiliária, tipo, área construída, área do terreno, pavimentos, blocos").
--
-- As colunas de endereço (endereco, bairro, cidade, uf, cep) JÁ EXISTEM em projetos_obras, mas a
-- ficha da obra não lê nem grava endereço — só identidade predial. Esta migration fecha o gap:
--   1) fn_obra_ficha_ler passa a devolver endereco/bairro/cidade/uf/cep (adição ao JSON; lógica intacta);
--   2) nova fn_obra_ficha_endereco_salvar (guardada por empresa, audit_log, normaliza UF/CEP);
--   3) textos de ajuda (RD-95) das 5 entradas + do botão salvar.
--
-- Não toca RLS, grants de tabela, nem dado de cliente (só a obra aberta pelo usuário, na empresa dele).
-- Prova RD-38 (BEGIN..ROLLBACK, obra DEMO-OB-002, endereco era NULL):
--   salvar('Av. Getúlio Vargas, 1200','Centro','Chapecó','sc','89.812-000') -> ok
--   ler -> endereco='Av. Getúlio Vargas, 1200', uf='SC', cep='89812000' (normalizados)
--   UF inválida ('SCC') -> {ok:false, 'UF deve ter 2 letras'}; CEP != 8 díg -> erro amigável.

-- 1) Leitura: devolver os campos de endereço -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_ler(p_obra_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    'ok', true, 'obra_id', v.id, 'numero', v.numero, 'nome', v.nome, 'cliente_nome', v.cliente_nome,
    'tipo_execucao', v.tipo_execucao, 'modelo_contratacao', v.modelo_contratacao,
    'matricula', v.matricula, 'inscricao_imobiliaria', v.inscricao_imobiliaria, 'tipo_edificacao', v.tipo_edificacao,
    'area_construida_m2', v.area_construida_m2, 'area_terreno_m2', v.area_terreno_m2,
    'endereco', v.endereco, 'bairro', v.bairro, 'cidade', v.cidade, 'uf', v.uf, 'cep', v.cep
  );
END; $function$;

-- 2) Gravação do endereço (nova) ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_endereco_salvar(
  p_obra_id uuid, p_endereco text, p_bairro text, p_cidade text, p_uf text, p_cep text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v public.projetos_obras%ROWTYPE;
  v_end text := nullif(btrim(p_endereco), '');
  v_bai text := nullif(btrim(p_bairro), '');
  v_cid text := nullif(btrim(p_cidade), '');
  v_uf  text := nullif(upper(btrim(p_uf)), '');
  v_cep text := nullif(regexp_replace(coalesce(p_cep, ''), '\D', '', 'g'), '');
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_uf IS NOT NULL AND v_uf !~ '^[A-Z]{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'UF deve ter 2 letras (ex.: SC).');
  END IF;
  IF v_cep IS NOT NULL AND length(v_cep) <> 8 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'CEP deve ter 8 dígitos.');
  END IF;

  UPDATE public.projetos_obras
     SET endereco = v_end, bairro = v_bai, cidade = v_cid, uf = v_uf, cep = v_cep, updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_endereco',
          jsonb_build_object('endereco', v.endereco, 'bairro', v.bairro, 'cidade', v.cidade, 'uf', v.uf, 'cep', v.cep),
          jsonb_build_object('endereco', v_end, 'bairro', v_bai, 'cidade', v_cid, 'uf', v_uf, 'cep', v_cep));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END; $function$;

-- 3) Ajuda RD-95 (idempotente por UNIQUE(chave)) --------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.obra_ficha.endereco', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Endereço da obra',
  'Logradouro e número do local da obra (rua, avenida, estrada, km).',
  'Localiza a obra para documentos, deslocamento da equipe, fornecedores e entrega.',
  'Av. Getúlio Vargas, 1200.',
  'Deixar só o número do lote sem o nome do logradouro — dificulta achar a obra.', 'hub_projetos', 10, 'publicado'),
 ('projetos.obra_ficha.bairro', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Bairro',
  'Bairro ou distrito onde fica a obra.',
  'Complementa o endereço e ajuda a agrupar obras por região.',
  'Centro.',
  'Repetir a cidade no campo bairro.', 'hub_projetos', 11, 'publicado'),
 ('projetos.obra_ficha.cidade', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Cidade',
  'Município onde a obra é executada.',
  'Usado em relatórios por localidade e em documentos oficiais da obra.',
  'Chapecó.',
  'Abreviar o nome do município.', 'hub_projetos', 12, 'publicado'),
 ('projetos.obra_ficha.uf', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'UF',
  'Sigla do estado com 2 letras.',
  'Identifica o estado da obra (documentos, impostos municipais/estaduais, filtros).',
  'SC.',
  'Escrever o nome do estado por extenso em vez da sigla de 2 letras.', 'hub_projetos', 13, 'publicado'),
 ('projetos.obra_ficha.cep', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'CEP',
  'CEP do endereço da obra (8 dígitos; pode digitar com ou sem traço).',
  'Padroniza o endereço e facilita entregas e emissão de documentos.',
  '89812-000.',
  'Informar menos de 8 dígitos ou o CEP de outro endereço.', 'hub_projetos', 14, 'publicado'),
 ('projetos.obra_ficha.salvar_endereco', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Salvar endereço',
  'Grava o endereço informado para esta obra.',
  'Guarda o local da obra; pode ser ajustado a qualquer momento.',
  'Preencha os campos e clique em Salvar endereço.',
  'Sair da tela sem clicar em salvar — as alterações do endereço não são gravadas.', 'hub_projetos', 15, 'publicado')
ON CONFLICT (chave) DO NOTHING;
