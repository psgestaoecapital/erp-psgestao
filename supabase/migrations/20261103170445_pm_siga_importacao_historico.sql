-- P&M · Importar do SIGA — HISTÓRICO/RASTRO de importações (auditor_pdca_2 01/11, tarefa 89e0d9e6, gap 1).
-- A tela de importação (/dashboard/pm/importar-siga) gravava os jobs mas NÃO deixava rastro de quem importou,
-- quando, quantas linhas entraram/ficaram de fora e o resultado. Sem histórico não há como auditar uma importação
-- nem comparar duas rodadas. Esta PR entrega o gap 1: tabela de histórico + registro na importação + leitura guardada.
--
-- ADITIVA: tabela/policy/RPC NOVAS (RLS por company_id, REVOKE anon). A função de importação existente só ganha
-- UM INSERT no histórico quando grava de verdade (p_gravar = true) — nenhum comportamento anterior muda; a prévia
-- (p_gravar = false) continua sem registrar nada. Idempotente: rodar a migration de novo não duplica.

-- 1) Tabela de histórico de importações do SIGA (uma linha por importação efetiva).
CREATE TABLE IF NOT EXISTS public.erp_pm_siga_importacao (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  importado_por                  uuid,
  importado_em                   timestamptz NOT NULL DEFAULT now(),
  total                          int NOT NULL DEFAULT 0,
  novos                          int NOT NULL DEFAULT 0,
  ja_existem                     int NOT NULL DEFAULT 0,
  gravados                       int NOT NULL DEFAULT 0,
  n_clientes_nao_encontrados     int NOT NULL DEFAULT 0,
  n_responsaveis_nao_encontrados int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS erp_pm_siga_importacao_company_idx
  ON public.erp_pm_siga_importacao (company_id, importado_em DESC);

ALTER TABLE public.erp_pm_siga_importacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_pm_siga_importacao_access ON public.erp_pm_siga_importacao;
CREATE POLICY erp_pm_siga_importacao_access ON public.erp_pm_siga_importacao FOR ALL
  USING      (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON TABLE public.erp_pm_siga_importacao FROM anon;
GRANT SELECT ON TABLE public.erp_pm_siga_importacao TO authenticated;

-- 2) A função de importação passa a registrar o histórico ao gravar (p_gravar = true).
--    Corpo idêntico ao vigente (20261002270000) + o INSERT final no histórico. Nada mais muda.
CREATE OR REPLACE FUNCTION public.fn_pm_importar_jobs_siga(p_company_id uuid, p_linhas jsonb, p_gravar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
                               rodada_ajuste, data_prazo, data_entrega, aguardando_desde, tags, created_at)
      VALUES (p_company_id, v_num, left(btrim(l->>'titulo'), 300), NULLIF(btrim(l->>'briefing'), ''), NULLIF(btrim(l->>'peca'), ''),
              v_status, v_cli, v_srv, v_resp, CASE WHEN v_resp IS NULL THEN v_resp_nome END,
              GREATEST(COALESCE((l->>'rodada')::int, 0), 0),
              CASE WHEN l->>'prazo' ~ '^\d{4}-\d{2}-\d{2}$' THEN (l->>'prazo')::date END,
              CASE WHEN v_status IN ('concluida', 'publicado') AND l->>'prazo' ~ '^\d{4}-\d{2}-\d{2}$' THEN (l->>'prazo')::date END,
              CASE WHEN v_status = 'aguardando' THEN now() END,
              ARRAY['siga'],
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
END $$;
REVOKE ALL ON FUNCTION public.fn_pm_importar_jobs_siga(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_importar_jobs_siga(uuid, jsonb, boolean) TO authenticated, service_role;

-- 3) Leitura guardada do histórico (as últimas N importações, com o nome de quem importou).
CREATE OR REPLACE FUNCTION public.fn_pm_siga_importacoes_listar(p_company_id uuid, p_limit int DEFAULT 20)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_itens jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x.importado_em DESC), '[]'::jsonb) INTO v_itens
  FROM (
    SELECT i.id, i.importado_em, i.total, i.novos, i.ja_existem, i.gravados,
           i.n_clientes_nao_encontrados, i.n_responsaveis_nao_encontrados,
           u.full_name AS importado_por_nome
    FROM public.erp_pm_siga_importacao i
    LEFT JOIN public.users u ON u.id = i.importado_por
    WHERE i.company_id = p_company_id
    ORDER BY i.importado_em DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  ) x;
  RETURN jsonb_build_object('ok', true, 'itens', v_itens);
END $$;
REVOKE ALL ON FUNCTION public.fn_pm_siga_importacoes_listar(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_siga_importacoes_listar(uuid, int) TO authenticated, service_role;

-- 4) RD-98 p3: registra a nova RPC na origem do dado da tela.
UPDATE public.system_screens
SET rpcs_chamadas = (
  SELECT ARRAY(SELECT DISTINCT e FROM unnest(COALESCE(rpcs_chamadas, ARRAY[]::text[])
    || ARRAY['fn_pm_siga_importacoes_listar']) e)
)
WHERE rota = '/dashboard/pm/importar-siga';

-- 5) RD-95: "?" do bloco Histórico.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'pm.siga.historico', 'Importar do SIGA', 'Histórico de importações',
       'Lista as importações já feitas nesta empresa: data, quem importou e o resultado de cada rodada.',
       'Serve para auditar: saber quando a Pauta foi alimentada pelo SIGA, por quem e quantos jobs entraram.',
       '01/11 14:20 · Ana · 312 novos · 58 já existiam.',
       'Achar que repetir a importação duplica jobs: número que já existe não entra de novo.',
       73, '/dashboard/pm/importar-siga', 'pm', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
