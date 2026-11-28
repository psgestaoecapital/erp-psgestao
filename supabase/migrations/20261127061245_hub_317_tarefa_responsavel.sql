-- Hub §317 (blueprint essencial): "Responsável definido por atividade do cronograma".
-- Aditivo: 1 coluna nullable + reescrita retrocompatível de fn_obra_tarefa_salvar (lê a chave
-- só quando enviada, preservando todo o comportamento atual) + 1 chave de ajuda RD-95.
-- Não toca RLS/grants, não apaga nada, não altera dado de cliente.

ALTER TABLE public.projetos_obra_tarefa
  ADD COLUMN IF NOT EXISTS responsavel_user_id uuid;

CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_salvar(p_obra_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_id uuid := NULLIF(p_dados->>'id','')::uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_id IS NULL THEN
    INSERT INTO public.projetos_obra_tarefa (company_id, obra_id, pai_id, nome, inicio, fim, percentual, ordem, responsavel_user_id, criado_por)
    VALUES (v_company, p_obra_id, NULLIF(p_dados->>'pai_id','')::uuid, p_dados->>'nome',
      (p_dados->>'inicio')::date, (p_dados->>'fim')::date,
      COALESCE((p_dados->>'percentual')::numeric, 0), COALESCE((p_dados->>'ordem')::int, 0),
      NULLIF(p_dados->>'responsavel_user_id','')::uuid, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.projetos_obra_tarefa SET
      nome = COALESCE(p_dados->>'nome', nome),
      inicio = COALESCE((p_dados->>'inicio')::date, inicio),
      fim = COALESCE((p_dados->>'fim')::date, fim),
      percentual = COALESCE((p_dados->>'percentual')::numeric, percentual),
      ordem = COALESCE((p_dados->>'ordem')::int, ordem),
      responsavel_user_id = CASE WHEN p_dados ? 'responsavel_user_id'
        THEN NULLIF(p_dados->>'responsavel_user_id','')::uuid ELSE responsavel_user_id END
    WHERE id = v_id AND obra_id = p_obra_id AND company_id = v_company AND excluido_em IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- Reafirma a ACL viva (o CREATE OR REPLACE não reseta grants; o gate check_fn_guards confere o texto).
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_salvar(uuid, jsonb) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES (
  'projetos.cronograma.responsavel',
  '/dashboard/projetos/obras/[id]/cronograma',
  'Cronograma da obra',
  'Responsável',
  'Escolha quem responde por esta atividade entre os usuários da empresa. Opcional.',
  'Deixa claro quem toca cada etapa do cronograma e aparece na lista de tarefas.',
  'Mestre de obras na etapa de alvenaria; engenheiro na etapa de estrutura.',
  'Deixar sem responsável nas atividades do caminho crítico: ninguém fica cobrado pelo prazo.',
  'hub_construcao',
  23,
  1,
  'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status;
