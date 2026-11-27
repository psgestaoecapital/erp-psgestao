-- PM-Q · PDCA 27/11 (rota /dashboard/pm/importar-sistema-anterior · tela 120): o importador do sistema anterior
-- passa a MAPEAR e PERSISTIR o fornecedor (gráfica/produtora) e os terceiros (freelancers/parceiros) de cada job.
-- Antes, essas colunas da exportação não eram mapeadas nem gravadas e se perdiam na implantação.
--
-- ADITIVA (RD-94.1): duas colunas de texto livre em agency_jobs (sem apagar/alterar dado existente) + CREATE OR
-- REPLACE da fn_pm_importar_jobs_siga só para gravar os dois campos novos no INSERT. RLS da tabela intacta; a função
-- segue SECURITY DEFINER com fn__guarda_empresa + fn_acessos_pode_gerir e REVOKE anon. Nada mais muda.

ALTER TABLE public.agency_jobs ADD COLUMN IF NOT EXISTS fornecedor text;
ALTER TABLE public.agency_jobs ADD COLUMN IF NOT EXISTS terceiros  text;
COMMENT ON COLUMN public.agency_jobs.fornecedor IS 'Fornecedor do job (gráfica/produtora), importado do sistema anterior — texto livre.';
COMMENT ON COLUMN public.agency_jobs.terceiros  IS 'Terceiros do job (freelancers/parceiros), importado do sistema anterior — texto livre.';

CREATE OR REPLACE FUNCTION public.fn_pm_importar_jobs_siga(p_company_id uuid, p_linhas jsonb, p_gravar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  l jsonb; v_num text; v_cli uuid; v_erp uuid; v_resp uuid; v_resp_nome text; v_srv uuid; v_n int;
  v_total int := 0; v_novos int := 0; v_existem int := 0; v_gravados int := 0;
  v_sem_cli text[] := ARRAY[]::text[]; v_sem_resp text[] := ARRAY[]::text[]; v_sem_peca text[] := ARRAY[]::text[];
  v_status text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF auth.uid() IS NOT NULL AND NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RAISE EXCEPTION 'Só o gestor da empresa importa jobs' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_linhas) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'erro', 'linhas_invalidas'); END IF;
  IF jsonb_array_length(p_linhas) > 5000 THEN RETURN jsonb_build_object('ok', false, 'erro', 'muitas_linhas', 'mensagem', 'Importe no máximo 5.000 jobs por vez.'); END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_total := v_total + 1;
    v_num := NULLIF(btrim(l->>'numero'), '');
    CONTINUE WHEN v_num IS NULL OR v_num !~ '^\d{1,12}$' OR NULLIF(btrim(l->>'titulo'), '') IS NULL;
    IF EXISTS (SELECT 1 FROM agency_jobs WHERE company_id = p_company_id AND numero = v_num) THEN
      v_existem := v_existem + 1; CONTINUE;
    END IF;
    v_novos := v_novos + 1;

    -- cliente
    v_cli := NULL; v_erp := NULL;
    IF NULLIF(btrim(l->>'cliente'), '') IS NOT NULL THEN
      SELECT count(*), min(id::text)::uuid INTO v_n, v_erp FROM erp_clientes
       WHERE company_id = p_company_id AND ativo IS NOT FALSE
         AND (lower(btrim(nome_fantasia)) = lower(btrim(l->>'cliente')) OR lower(btrim(razao_social)) = lower(btrim(l->>'cliente')));
      IF v_n <> 1 THEN
        v_erp := NULL;
        SELECT id INTO v_cli FROM agency_clientes WHERE company_id = p_company_id
           AND lower(COALESCE(NULLIF(btrim(nome_fantasia), ''), btrim(nome))) = lower(btrim(l->>'cliente'))
         ORDER BY erp_cliente_id IS NULL, created_at NULLS LAST LIMIT 1;
        IF v_cli IS NULL AND NOT (btrim(l->>'cliente') = ANY (v_sem_cli)) THEN v_sem_cli := v_sem_cli || btrim(l->>'cliente'); END IF;
      END IF;
    END IF;

    -- responsável
    v_resp := NULL; v_resp_nome := NULLIF(btrim(l->>'responsavel'), '');
    IF v_resp_nome IS NOT NULL THEN
      SELECT count(*), min(u.id::text)::uuid INTO v_n, v_resp FROM user_companies uc JOIN users u ON u.id = uc.user_id
       WHERE uc.company_id = p_company_id AND lower(btrim(u.full_name)) = lower(v_resp_nome);
      IF v_n <> 1 THEN
        SELECT count(*), min(u.id::text)::uuid INTO v_n, v_resp FROM user_companies uc JOIN users u ON u.id = uc.user_id
         WHERE uc.company_id = p_company_id AND lower(split_part(btrim(u.full_name), ' ', 1)) = lower(split_part(v_resp_nome, ' ', 1));
        IF v_n <> 1 THEN
          v_resp := NULL;
          IF NOT (v_resp_nome = ANY (v_sem_resp)) THEN v_sem_resp := v_sem_resp || v_resp_nome; END IF;
        END IF;
      END IF;
    END IF;

    -- peça
    v_srv := NULL;
    IF NULLIF(btrim(l->>'peca'), '') IS NOT NULL THEN
      SELECT id INTO v_srv FROM agency_servico WHERE company_id = p_company_id AND lower(btrim(nome)) = lower(btrim(l->>'peca')) LIMIT 1;
      IF v_srv IS NULL AND NOT (btrim(l->>'peca') = ANY (v_sem_peca)) THEN v_sem_peca := v_sem_peca || btrim(l->>'peca'); END IF;
    END IF;

    IF p_gravar THEN
      IF v_erp IS NOT NULL THEN v_cli := public.fn_pm_cliente_garantir(p_company_id, v_erp); END IF;
      v_status := CASE WHEN l->>'situacao' IN ('nao_iniciada', 'em_producao', 'aguardando', 'em_aprovacao', 'concluida', 'publicado')
                       THEN l->>'situacao' ELSE 'em_producao' END;
      INSERT INTO agency_jobs (company_id, numero, titulo, descricao, tipo, status, cliente_id, servico_id, responsavel_id, responsavel_nome,
                               rodada_ajuste, data_prazo, data_entrega, aguardando_desde, tags, fornecedor, terceiros, created_at)
      VALUES (p_company_id, v_num, left(btrim(l->>'titulo'), 300), NULLIF(btrim(l->>'briefing'), ''), NULLIF(btrim(l->>'peca'), ''),
              v_status, v_cli, v_srv, v_resp, CASE WHEN v_resp IS NULL THEN v_resp_nome END,
              GREATEST(COALESCE((l->>'rodada')::int, 0), 0),
              CASE WHEN l->>'prazo' ~ '^\d{4}-\d{2}-\d{2}$' THEN (l->>'prazo')::date END,
              CASE WHEN v_status IN ('concluida', 'publicado') AND l->>'prazo' ~ '^\d{4}-\d{2}-\d{2}$' THEN (l->>'prazo')::date END,
              CASE WHEN v_status = 'aguardando' THEN now() END,
              ARRAY['siga'],
              NULLIF(btrim(l->>'fornecedor'), ''), NULLIF(btrim(l->>'terceiros'), ''),
              COALESCE(CASE WHEN l->>'criacao' ~ '^\d{4}-\d{2}-\d{2}$' THEN ((l->>'criacao')::date + time '12:00') AT TIME ZONE 'America/Sao_Paulo' END, now()));
      v_gravados := v_gravados + 1;
    END IF;
  END LOOP;

  -- HISTÓRICO (gap 1): só quando gravou de verdade. Deixa o rastro de quem/quando/contagens para auditar a rodada.
  IF p_gravar THEN
    INSERT INTO public.erp_pm_siga_importacao
      (company_id, importado_por, total, novos, ja_existem, gravados, n_clientes_nao_encontrados, n_responsaveis_nao_encontrados)
    VALUES (p_company_id, auth.uid(), v_total, v_novos, v_existem, v_gravados,
            COALESCE(array_length(v_sem_cli, 1), 0), COALESCE(array_length(v_sem_resp, 1), 0));
  END IF;

  RETURN jsonb_build_object('ok', true, 'gravou', p_gravar, 'total', v_total, 'novos', v_novos, 'ja_existem', v_existem,
    'gravados', v_gravados,
    'clientes_nao_encontrados', to_jsonb(v_sem_cli[1:50]), 'n_clientes_nao_encontrados', COALESCE(array_length(v_sem_cli, 1), 0),
    'responsaveis_nao_encontrados', to_jsonb(v_sem_resp[1:50]), 'n_responsaveis_nao_encontrados', COALESCE(array_length(v_sem_resp, 1), 0),
    'pecas_nao_encontradas', to_jsonb(v_sem_peca[1:50]));
END $function$;

REVOKE ALL ON FUNCTION public.fn_pm_importar_jobs_siga(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_importar_jobs_siga(uuid, jsonb, boolean) TO authenticated, service_role;
