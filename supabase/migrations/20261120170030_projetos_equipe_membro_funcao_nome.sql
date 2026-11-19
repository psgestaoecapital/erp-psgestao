-- CEO 18/11 (testando a aba Equipes do #5516): no modal de equipe, a FUNÇÃO deve vir da MESMA fonte da aba "Funções"
-- (erp_funcao_mao_obra, via fn_mao_obra_listar) e a PESSOA do cadastro da aba "Equipe" (erp_mao_obra_custo), com o
-- custo/hora preenchido automaticamente e editável. Como as funções da empresa (erp_funcao_mao_obra) NÃO têm vínculo
-- com projetos_mao_obra (provado: 0/14 da FC têm projetos_mao_obra_id), o membro precisa guardar o NOME da função como
-- rótulo próprio (snapshot), independente da FK projetos_mao_obra.
--
-- Aditiva (RD-97): + coluna funcao_nome em projetos_equipe_membro; fn_projetos_equipe_salvar grava esse rótulo e
-- fn_projetos_equipe_listar devolve coalesce(funcao_nome, nome da função do catálogo). Nada destrutivo; equipes
-- existentes seguem válidas (funcao_nome nulo cai no fallback da função). SENSÍVEL (CREATE OR REPLACE) → revisor.

ALTER TABLE public.projetos_equipe_membro ADD COLUMN IF NOT EXISTS funcao_nome text;

-- Salvar: grava também o rótulo da função (snapshot), além da FK opcional para projetos_mao_obra.
CREATE OR REPLACE FUNCTION public.fn_projetos_equipe_salvar(
  p_company_id uuid,
  p_equipe     jsonb,
  p_membros    jsonb DEFAULT '[]'::jsonb,
  p_id         uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_interno  boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_id       uuid := p_id;
  v_nome     text := nullif(btrim(coalesce(p_equipe->>'nome', '')), '');
  v_desc     text := nullif(btrim(coalesce(p_equipe->>'descricao', '')), '');
  v_ajustado boolean;
  v_medio    numeric;
  v_qtd      integer;
BEGIN
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio');
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.projetos_equipe (company_id, nome, descricao, created_by)
    VALUES (p_company_id, v_nome, v_desc, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projetos_equipe
       SET nome = v_nome, descricao = v_desc, updated_at = now()
     WHERE id = v_id AND company_id = p_company_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'equipe_nao_encontrada');
    END IF;
  END IF;

  DELETE FROM public.projetos_equipe_membro WHERE equipe_id = v_id;
  INSERT INTO public.projetos_equipe_membro (equipe_id, company_id, nome_pessoa, funcao_mao_obra_id, funcao_nome, custo_hora, ordem)
  SELECT v_id,
         p_company_id,
         nullif(btrim(coalesce(m->>'nome_pessoa', '')), ''),
         (SELECT mo.id FROM public.projetos_mao_obra mo
           WHERE mo.id = nullif(m->>'funcao_mao_obra_id', '')::uuid AND mo.company_id = p_company_id),
         nullif(btrim(coalesce(m->>'funcao_nome', '')), ''),
         round(coalesce((m->>'custo_hora')::numeric, 0), 2),
         (ord - 1)::integer
    FROM jsonb_array_elements(coalesce(p_membros, '[]'::jsonb)) WITH ORDINALITY AS t(m, ord)
   WHERE coalesce((m->>'custo_hora')::numeric, 0) > 0;

  SELECT round(avg(custo_hora), 2), count(*) INTO v_medio, v_qtd
    FROM public.projetos_equipe_membro WHERE equipe_id = v_id;

  SELECT ajustado INTO v_ajustado FROM public.projetos_equipe WHERE id = v_id;

  UPDATE public.projetos_equipe
     SET custo_medio_hora   = v_medio,
         qtd_pessoas        = coalesce(v_qtd, 0),
         custo_hora_efetivo = CASE WHEN v_ajustado THEN custo_hora_efetivo ELSE v_medio END,
         updated_at         = now()
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'custo_medio_hora', v_medio, 'qtd_pessoas', coalesce(v_qtd, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_equipe_salvar(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_equipe_salvar(uuid, jsonb, jsonb, uuid) TO authenticated, service_role;

-- Listar: o rótulo da função é o snapshot do membro; se nulo (equipes antigas), cai no nome da função do catálogo.
CREATE OR REPLACE FUNCTION public.fn_projetos_equipe_listar(p_company_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_out     jsonb;
BEGIN
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.ativo DESC, lower(e.nome)), '[]'::jsonb) INTO v_out
  FROM (
    SELECT eq.id, eq.nome, eq.descricao, eq.custo_medio_hora, eq.custo_hora_efetivo,
           eq.qtd_pessoas, eq.ajustado, eq.ativo,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', m.id,
                      'nome_pessoa', m.nome_pessoa,
                      'funcao_mao_obra_id', m.funcao_mao_obra_id,
                      'funcao_nome', coalesce(m.funcao_nome, mo.funcao),
                      'custo_hora', m.custo_hora,
                      'ordem', m.ordem
                    ) ORDER BY m.ordem, m.created_at)
             FROM public.projetos_equipe_membro m
             LEFT JOIN public.projetos_mao_obra mo ON mo.id = m.funcao_mao_obra_id
             WHERE m.equipe_id = eq.id
           ), '[]'::jsonb) AS membros
    FROM public.projetos_equipe eq
    WHERE eq.company_id = p_company_id
  ) e;

  RETURN jsonb_build_object('ok', true, 'equipes', v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_equipe_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_equipe_listar(uuid) TO authenticated, service_role;

-- Ajuda do novo campo "Pessoa" (RD-95).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
  ('projetos.mao_obra.equipes.membro_pessoa', '/dashboard/projetos/mao-obra', 'Equipes', 'Pessoa', 'Escolha quem faz parte da equipe a partir do cadastro da empresa (aba Equipe). Traz a função e o custo/hora da pessoa. Use "Digitar manual" para alguém fora do cadastro.', 'Monta a equipe com gente real da empresa e já puxa o custo/hora dela, sem redigitar.', 'Airton Souza · Pedreiro', 'Procurar alguém que ainda não está no cadastro: use "Digitar manual" ou cadastre na aba Equipe antes.', 'hub_projetos', 414)
ON CONFLICT (chave) DO NOTHING;
