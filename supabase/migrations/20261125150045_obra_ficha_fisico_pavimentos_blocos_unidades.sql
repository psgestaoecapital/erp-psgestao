-- Hub · Obra como cadastro central (blueprint vivo tela 314) — fatia física da ficha.
-- Acrescenta à ficha da obra os campos físicos pavimentos, blocos e unidades, que
-- completam o requisito essencial "área construída, área do terreno, pavimentos, blocos
-- e unidades" da tela 314. Aditivo e idempotente: colunas novas (sem default, nullable),
-- sem rewrite de tabela; CREATE OR REPLACE do leitor e substituição do gravador de
-- identidade para carregar/gravar os 3 campos. Não toca RLS, não altera dado de cliente.

-- 1) Colunas novas (aditivas, idempotentes)
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS pavimentos integer;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS blocos integer;
ALTER TABLE public.projetos_obras ADD COLUMN IF NOT EXISTS unidades integer;

COMMENT ON COLUMN public.projetos_obras.pavimentos IS 'Ficha da obra (tela 314): número de pavimentos da edificação.';
COMMENT ON COLUMN public.projetos_obras.blocos IS 'Ficha da obra (tela 314): número de blocos/torres da obra.';
COMMENT ON COLUMN public.projetos_obras.unidades IS 'Ficha da obra (tela 314): número de unidades (apartamentos/salas/lotes).';

-- 2) Leitor da ficha devolve também os campos físicos
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
    'area_terreno_m2', v.area_terreno_m2,
    'pavimentos', v.pavimentos,
    'blocos', v.blocos,
    'unidades', v.unidades
  );
END; $function$;

-- 3) Gravador de identidade carrega os 3 campos novos (opcionais, default NULL para
--    manter compatível as chamadas atuais de 6 argumentos). Substitui a versão de 6 args.
DROP FUNCTION IF EXISTS public.fn_obra_ficha_identidade_salvar(uuid, text, text, text, numeric, numeric);
CREATE OR REPLACE FUNCTION public.fn_obra_ficha_identidade_salvar(
  p_obra_id uuid,
  p_matricula text,
  p_inscricao_imobiliaria text,
  p_tipo_edificacao text,
  p_area_construida_m2 numeric,
  p_area_terreno_m2 numeric,
  p_pavimentos integer DEFAULT NULL,
  p_blocos integer DEFAULT NULL,
  p_unidades integer DEFAULT NULL)
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
  IF p_pavimentos IS NOT NULL AND p_pavimentos < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Número de pavimentos não pode ser negativo.');
  END IF;
  IF p_blocos IS NOT NULL AND p_blocos < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Número de blocos não pode ser negativo.');
  END IF;
  IF p_unidades IS NOT NULL AND p_unidades < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Número de unidades não pode ser negativo.');
  END IF;

  UPDATE public.projetos_obras
     SET matricula = v_mat, inscricao_imobiliaria = v_insc, tipo_edificacao = v_tipo,
         area_construida_m2 = p_area_construida_m2, area_terreno_m2 = p_area_terreno_m2,
         pavimentos = p_pavimentos, blocos = p_blocos, unidades = p_unidades, updated_at = now()
   WHERE id = p_obra_id;

  INSERT INTO public.audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_obras', p_obra_id::text, 'obra_ficha_identidade',
          jsonb_build_object('matricula', v.matricula, 'inscricao_imobiliaria', v.inscricao_imobiliaria, 'tipo_edificacao', v.tipo_edificacao, 'area_construida_m2', v.area_construida_m2, 'area_terreno_m2', v.area_terreno_m2, 'pavimentos', v.pavimentos, 'blocos', v.blocos, 'unidades', v.unidades),
          jsonb_build_object('matricula', v_mat, 'inscricao_imobiliaria', v_insc, 'tipo_edificacao', v_tipo, 'area_construida_m2', p_area_construida_m2, 'area_terreno_m2', p_area_terreno_m2, 'pavimentos', p_pavimentos, 'blocos', p_blocos, 'unidades', p_unidades));

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id);
END; $function$;

-- Grants: recria a postura da versão anterior (sem anon/public), já que o DROP acima
-- removeu os grants junto com a função.
REVOKE ALL ON FUNCTION public.fn_obra_ficha_identidade_salvar(uuid, text, text, text, numeric, numeric, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_ficha_identidade_salvar(uuid, text, text, text, numeric, numeric, integer, integer, integer) TO authenticated, service_role;

-- 4) Ajuda ("?") dos 3 campos novos — RD-95. Idempotente (não reinsere se a chave já existe).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('projetos.obra_ficha.pavimentos', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Pavimentos',
   'Informe o número de pavimentos (andares) da edificação, incluindo térreo e subsolos.',
   'Caracteriza o porte da obra e apoia indicadores físicos (ex.: custo por pavimento) e o planejamento da execução.',
   '12 (para um prédio de 12 andares).',
   'Contar só os andares-tipo e esquecer térreo, subsolos e cobertura.',
   'hub_projetos', 8, 'publicado'),
  ('projetos.obra_ficha.blocos', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Blocos',
   'Informe quantos blocos ou torres a obra tem. Para obra de bloco único, informe 1.',
   'Permite dimensionar a obra e organizar o acompanhamento físico quando há mais de um bloco.',
   '3 (para um condomínio com 3 torres).',
   'Deixar vazio em obra com vários blocos — informe 1 quando for bloco único.',
   'hub_projetos', 9, 'publicado'),
  ('projetos.obra_ficha.unidades', '/dashboard/projetos/obras/[id]/ficha', 'Ficha da obra', 'Unidades',
   'Informe o número total de unidades da obra (apartamentos, salas, lojas ou lotes).',
   'Base para indicadores por unidade (ex.: custo por unidade) e para o planejamento de vendas/entrega.',
   '48 (para um edifício com 48 apartamentos).',
   'Confundir unidades com pavimentos — são contagens diferentes.',
   'hub_projetos', 10, 'publicado')
) AS novo(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = novo.chave);
