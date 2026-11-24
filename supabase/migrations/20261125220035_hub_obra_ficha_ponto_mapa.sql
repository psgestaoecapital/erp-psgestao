-- Hub · Gestão de Obras · Ficha da obra — PONTO NO MAPA (blueprint vivo tela 314,
-- "obra como cadastro central": requisito ESSENCIAL "Ficha da obra: nome, endereço e
-- PONTO NO MAPA, matrícula, inscrição imobiliária, tipo, área construída, área do terreno").
--
-- A ficha (PR #5751/#5773) já grava identidade e endereço (texto), mas NÃO guarda o ponto no
-- mapa (latitude/longitude) — o usuário não marca nem visualiza a obra no mapa. Esta migration
-- fecha o último gap da tela 314:
--   1) colunas ADITIVAS latitude/longitude em projetos_obras (sem default, nullable; não toca dado);
--   2) leitor PRÓPRIO fn_obra_ficha_mapa_ler (collision-free: NÃO recria fn_obra_ficha_ler);
--   3) nova fn_obra_ficha_mapa_salvar (guardada por empresa, audit_log, valida faixas de lat/long);
--   4) textos de ajuda (RD-95) das 2 entradas + do botão salvar.
--
-- COLLISION-FREE (padrão das fatias #5751/#5962/#5773 que coexistem na mesma tela): o mapa ganha
-- leitor próprio, e a tela lê os três (classificação/identidade via fn_obra_ficha_ler, endereço via
-- fn_obra_ficha_endereco_ler, mapa aqui) — a ordem de merge não sobrescreve campos de outra fatia.
--
-- Não toca RLS de tabela, grants de tabela, nem dado de cliente (só a obra aberta pelo usuário, na
-- empresa dele). ADITIVA (RD-94.1 c): colunas/função NOVAS, guarda por empresa, REVOKE anon.
-- Prova RD-38 (BEGIN..ROLLBACK, obra DEMO ...006, latitude era NULL):
--   mapa_salvar(-27.100500, -52.615200) -> ok; mapa_ler -> latitude=-27.1005, longitude=-52.6152;
--   fora da faixa (lat 95) -> {ok:false, 'Latitude deve estar entre -90 e 90'}; audit_log gravado.

-- 1) Colunas ADITIVAS do ponto no mapa ------------------------------------------------------------
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS latitude  numeric;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS longitude numeric;
COMMENT ON COLUMN public.projetos_obras.latitude  IS 'Ponto da obra no mapa — latitude (graus decimais, -90..90). Ficha da obra, tela 314.';
COMMENT ON COLUMN public.projetos_obras.longitude IS 'Ponto da obra no mapa — longitude (graus decimais, -180..180). Ficha da obra, tela 314.';

-- 2) Leitura PRÓPRIA do ponto no mapa (não toca fn_obra_ficha_ler) ---------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_mapa_ler(p_obra_id uuid)
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
    'ok', true, 'obra_id', v.id, 'latitude', v.latitude, 'longitude', v.longitude
  );
END; $function$;

-- 3) Gravação do ponto no mapa (nova) -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_mapa_salvar(
  p_obra_id uuid, p_latitude numeric, p_longitude numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v public.projetos_obras%ROWTYPE;
  v_lat numeric := p_latitude;
  v_lng numeric := p_longitude;
BEGIN
  SELECT * INTO v FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada'); END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v.company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  -- Limpar o ponto = os dois vazios juntos; um sem o outro é inconsistente.
  IF (v_lat IS NULL) <> (v_lng IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe latitude e longitude juntas (ou deixe as duas em branco para limpar o ponto).');
  END IF;
  IF v_lat IS NOT NULL AND (v_lat < -90 OR v_lat > 90) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Latitude deve estar entre -90 e 90.');
  END IF;
  IF v_lng IS NOT NULL AND (v_lng < -180 OR v_lng > 180) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Longitude deve estar entre -180 e 180.');
  END IF;

  UPDATE public.projetos_obras
     SET latitude = v_lat, longitude = v_lng, updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_mapa',
          jsonb_build_object('latitude', v.latitude, 'longitude', v.longitude),
          jsonb_build_object('latitude', v_lat, 'longitude', v_lng));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'latitude', v_lat, 'longitude', v_lng);
END; $function$;

-- 4) Ajuda RD-95 (idempotente por UNIQUE(chave)) --------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.obra_ficha.latitude', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Latitude',
  'Coordenada norte-sul do ponto da obra, em graus decimais (entre -90 e 90). No Brasil é um número negativo.',
  'Marca a obra no mapa para deslocamento da equipe, logística de fornecedores e documentos.',
  '-27.100500',
  'Usar vírgula no lugar do ponto decimal, ou trocar latitude por longitude.', 'hub_projetos', 16, 'publicado'),
 ('projetos.obra_ficha.longitude', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Longitude',
  'Coordenada leste-oeste do ponto da obra, em graus decimais (entre -180 e 180). No Brasil é um número negativo.',
  'Junto com a latitude, fixa o pino da obra no mapa.',
  '-52.615200',
  'Informar só uma das coordenadas — o ponto precisa das duas para aparecer no mapa.', 'hub_projetos', 17, 'publicado'),
 ('projetos.obra_ficha.usar_localizacao', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Usar minha localização',
  'Preenche latitude e longitude com a localização atual do aparelho (ideal no celular, dentro da obra).',
  'Evita digitar as coordenadas: pega o ponto do GPS do aparelho e você ajusta se precisar.',
  'Na obra, toque e confirme o acesso à localização quando o navegador pedir.',
  'Usar no computador longe da obra — o ponto fica no lugar errado; prefira o celular no local.', 'hub_projetos', 18, 'publicado'),
 ('projetos.obra_ficha.salvar_mapa', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Salvar ponto no mapa',
  'Grava o ponto (latitude/longitude) informado para esta obra.',
  'Guarda a localização da obra no mapa; pode ser ajustada a qualquer momento. Deixe as duas em branco para limpar.',
  'Marque o ponto (digite ou use a localização) e clique em Salvar ponto no mapa.',
  'Sair da tela sem clicar em salvar — o ponto não é gravado.', 'hub_projetos', 19, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 5) ACL explícita (check_fn_guards regra 1): fecha anon/PUBLIC em toda função SECURITY DEFINER nova ----
REVOKE ALL ON FUNCTION public.fn_obra_ficha_mapa_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_mapa_ler(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_obra_ficha_mapa_salvar(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_mapa_salvar(uuid, numeric, numeric) TO authenticated, service_role;
