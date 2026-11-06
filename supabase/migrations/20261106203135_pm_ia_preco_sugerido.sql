-- PDCA P&M (auditor_pdca_2) · /dashboard/pm/ia-preco (IA Preço Ótimo) — TIRA A TELA DO PREVIEW (RD-98 p1).
-- Code: code-desenvolvedor-3 · META CEO (preço sugerido) · 01/11
--
-- A tela era ModuloPreview (8 linhas) = TELA MORTA (RD-98 p1). Esta migration ADITIVA cria a camada de dados da
-- tela REAL de sugestão de preço:
--   (1) agency_margem_alvo — margem-alvo configurável por empresa (geral) e por serviço, com EXCLUSÃO RASTREÁVEL
--       (deleted_at + deleted_por + audit_log_global) — RD-98 p2/p4. RLS por empresa, REVOKE anon, escrita só por função.
--   (2) fn_pm_preco_sugerido — a partir de jobs SEMELHANTES (mesmo serviço/tipo) calcula custo real médio (horas × custo),
--       aplica a margem-alvo e devolve o PREÇO sugerido, lucro e markup — tudo com dado real (RD-38), nunca achismo.
--   (3) fn_pm_margem_alvo_listar/salvar/excluir — CRUD da margem-alvo (Incluir/Editar/Excluir rastreável).
--   (4) system_screens (origem do dado · RD-98 p3) e erp_ajuda_campo (RD-95 "?") da tela.
-- NÃO apaga nem altera dado de cliente; não altera nenhuma função/view/policy existente.

-- (1) Tabela da margem-alvo (aditiva) ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_margem_alvo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  servico_id    uuid,                                   -- NULL = margem-alvo GERAL (padrão da empresa)
  margem_pct    numeric NOT NULL CHECK (margem_pct >= 0 AND margem_pct < 100),
  observacao    text,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_por   uuid
);
-- uma margem ATIVA por serviço e uma GERAL ativa por empresa (soft-delete libera recriar)
CREATE UNIQUE INDEX IF NOT EXISTS uq_margem_alvo_ativo_servico
  ON public.agency_margem_alvo (company_id, servico_id) WHERE deleted_at IS NULL AND servico_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_margem_alvo_ativo_geral
  ON public.agency_margem_alvo (company_id) WHERE deleted_at IS NULL AND servico_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_margem_alvo_empresa
  ON public.agency_margem_alvo (company_id) WHERE deleted_at IS NULL;

ALTER TABLE public.agency_margem_alvo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_margem_alvo_select ON public.agency_margem_alvo;
CREATE POLICY agency_margem_alvo_select ON public.agency_margem_alvo
  FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
REVOKE ALL ON public.agency_margem_alvo FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.agency_margem_alvo FROM authenticated;
GRANT SELECT ON public.agency_margem_alvo TO authenticated;
GRANT ALL ON public.agency_margem_alvo TO service_role;

-- (2) Preço sugerido a partir do histórico real -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pm_preco_sugerido(
  p_company_id uuid, p_servico_id uuid DEFAULT NULL, p_tipo text DEFAULT NULL, p_margem_pct numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_margem numeric; v_fonte_margem text;
  v_custo_real numeric; v_n_real int; v_custo_est numeric; v_n_est int;
  v_horas numeric; v_valor numeric; v_n_valor int;
  v_custo_base numeric; v_fonte_custo text; v_preco numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  -- margem-alvo: parâmetro informado > margem do serviço > margem geral da empresa > 30% (padrão)
  IF p_margem_pct IS NOT NULL THEN
    v_margem := p_margem_pct; v_fonte_margem := 'parametro';
  ELSIF p_servico_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.agency_margem_alvo
         WHERE company_id = p_company_id AND servico_id = p_servico_id AND deleted_at IS NULL) THEN
    SELECT margem_pct INTO v_margem FROM public.agency_margem_alvo
      WHERE company_id = p_company_id AND servico_id = p_servico_id AND deleted_at IS NULL;
    v_fonte_margem := 'servico';
  ELSIF EXISTS (SELECT 1 FROM public.agency_margem_alvo
                 WHERE company_id = p_company_id AND servico_id IS NULL AND deleted_at IS NULL) THEN
    SELECT margem_pct INTO v_margem FROM public.agency_margem_alvo
      WHERE company_id = p_company_id AND servico_id IS NULL AND deleted_at IS NULL;
    v_fonte_margem := 'geral';
  ELSE
    v_margem := 30; v_fonte_margem := 'padrao';
  END IF;
  IF v_margem < 0  THEN v_margem := 0;  END IF;
  IF v_margem > 95 THEN v_margem := 95; END IF;   -- trava para a divisão não explodir

  -- jobs semelhantes: mesmo serviço; sem serviço, mesmo tipo; sem ambos, toda a carteira da empresa
  WITH base AS (
    SELECT j.id, j.valor_job, j.custo_estimado
      FROM public.agency_jobs j
     WHERE j.company_id = p_company_id AND j.excluido_em IS NULL
       AND ( (p_servico_id IS NOT NULL AND j.servico_id = p_servico_id)
          OR (p_servico_id IS NULL AND p_tipo IS NOT NULL AND j.tipo = p_tipo)
          OR (p_servico_id IS NULL AND p_tipo IS NULL) )
  ), custos AS (
    SELECT c.job_id, sum(c.horas) AS horas, bool_or(c.tem_custo) AS tem_custo, sum(c.custo_total) AS custo_total
      FROM public.fn_pm_job_custos(p_company_id) c
      JOIN base b ON b.id = c.job_id
     GROUP BY c.job_id
  )
  SELECT
    avg(cu.custo_total) FILTER (WHERE cu.tem_custo AND cu.custo_total > 0),
    count(*)            FILTER (WHERE cu.tem_custo AND cu.custo_total > 0),
    avg(b.custo_estimado) FILTER (WHERE COALESCE(b.custo_estimado, 0) > 0),
    count(*)              FILTER (WHERE COALESCE(b.custo_estimado, 0) > 0),
    avg(cu.horas)       FILTER (WHERE COALESCE(cu.horas, 0) > 0),
    avg(b.valor_job)    FILTER (WHERE COALESCE(b.valor_job, 0) > 0),
    count(*)            FILTER (WHERE COALESCE(b.valor_job, 0) > 0)
  INTO v_custo_real, v_n_real, v_custo_est, v_n_est, v_horas, v_valor, v_n_valor
  FROM base b LEFT JOIN custos cu ON cu.job_id = b.id;

  IF COALESCE(v_custo_real, 0) > 0 THEN
    v_custo_base := v_custo_real; v_fonte_custo := 'real';
  ELSIF COALESCE(v_custo_est, 0) > 0 THEN
    v_custo_base := v_custo_est; v_fonte_custo := 'estimado';
  ELSE
    v_custo_base := NULL; v_fonte_custo := 'sem_custo';
  END IF;

  IF v_custo_base IS NOT NULL THEN
    v_preco := round(v_custo_base / (1 - v_margem / 100.0), 2);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'margem_pct', round(v_margem, 2), 'fonte_margem', v_fonte_margem,
    'custo_base', CASE WHEN v_custo_base IS NULL THEN NULL ELSE round(v_custo_base, 2) END,
    'fonte_custo', v_fonte_custo,
    'n_jobs_real', COALESCE(v_n_real, 0), 'n_jobs_estimado', COALESCE(v_n_est, 0),
    'horas_media', CASE WHEN v_horas IS NULL THEN NULL ELSE round(v_horas, 1) END,
    'valor_medio_praticado', CASE WHEN v_valor IS NULL THEN NULL ELSE round(v_valor, 2) END,
    'n_jobs_valor', COALESCE(v_n_valor, 0),
    'preco_sugerido', v_preco,
    'lucro_estimado', CASE WHEN v_preco IS NULL THEN NULL ELSE round(v_preco - v_custo_base, 2) END,
    'markup_pct', CASE WHEN COALESCE(v_custo_base, 0) = 0 THEN NULL ELSE round((v_preco / v_custo_base - 1) * 100, 1) END
  );
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_preco_sugerido(uuid, uuid, text, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_preco_sugerido(uuid, uuid, text, numeric) TO authenticated, service_role;

-- (3) CRUD da margem-alvo -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_pm_margem_alvo_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', m.id, 'servico_id', m.servico_id,
             'servico_nome', COALESCE(s.nome, 'Padrão da empresa (geral)'),
             'margem_pct', m.margem_pct, 'observacao', m.observacao, 'atualizado_em', m.atualizado_em
           ) ORDER BY (m.servico_id IS NOT NULL), COALESCE(s.nome, ''))
      FROM public.agency_margem_alvo m
      LEFT JOIN public.agency_servico s ON s.id = m.servico_id
     WHERE m.company_id = p_company_id AND m.deleted_at IS NULL
  ), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_margem_alvo_listar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_margem_alvo_listar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_pm_margem_alvo_salvar(
  p_company_id uuid, p_servico_id uuid, p_margem_pct numeric, p_observacao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_old numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF p_margem_pct IS NULL OR p_margem_pct < 0 OR p_margem_pct >= 100 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Margem deve ser maior ou igual a 0 e menor que 100'); END IF;
  IF p_servico_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.agency_servico WHERE id = p_servico_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'servico_invalido'); END IF;
  SELECT id, margem_pct INTO v_id, v_old FROM public.agency_margem_alvo
    WHERE company_id = p_company_id AND servico_id IS NOT DISTINCT FROM p_servico_id AND deleted_at IS NULL;
  IF v_id IS NOT NULL THEN
    UPDATE public.agency_margem_alvo
       SET margem_pct = p_margem_pct, observacao = nullif(btrim(p_observacao), ''), atualizado_em = now()
     WHERE id = v_id;
    INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
      VALUES (p_company_id, auth.uid(), 'agency_margem_alvo', v_id, 'atualizar',
              jsonb_build_object('margem_pct', v_old),
              jsonb_build_object('margem_pct', p_margem_pct, 'servico_id', p_servico_id));
  ELSE
    INSERT INTO public.agency_margem_alvo (company_id, servico_id, margem_pct, observacao, criado_por)
      VALUES (p_company_id, p_servico_id, p_margem_pct, nullif(btrim(p_observacao), ''), auth.uid())
      RETURNING id INTO v_id;
    INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
      VALUES (p_company_id, auth.uid(), 'agency_margem_alvo', v_id, 'incluir', NULL,
              jsonb_build_object('margem_pct', p_margem_pct, 'servico_id', p_servico_id));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_margem_alvo_salvar(uuid, uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_margem_alvo_salvar(uuid, uuid, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_pm_margem_alvo_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_del timestamptz; v_margem numeric; v_serv uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema'); END IF;
  SELECT company_id, deleted_at, margem_pct, servico_id INTO v_company, v_del, v_margem, v_serv
    FROM public.agency_margem_alvo WHERE id = p_id FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_del IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'id', p_id, 'ja_excluido', true); END IF;
  UPDATE public.agency_margem_alvo SET deleted_at = now(), deleted_por = auth.uid() WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'agency_margem_alvo', p_id, 'excluir',
            jsonb_build_object('margem_pct', v_margem, 'servico_id', v_serv),
            jsonb_build_object('deleted_at', now()));
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_margem_alvo_excluir(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_margem_alvo_excluir(uuid) TO authenticated, service_role;

-- (4) RD-98 p3 · origem do dado da tela --------------------------------------------------------------------------
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_servico','agency_jobs','agency_margem_alvo']::text[],
       rpcs_chamadas    = ARRAY['fn_pm_preco_sugerido','fn_pm_margem_alvo_listar','fn_pm_margem_alvo_salvar',
                                'fn_pm_margem_alvo_excluir','fn_ajuda_campo_listar']::text[]
 WHERE rota = '/dashboard/pm/ia-preco';

-- (5) RD-95 · "?" de cada campo/indicador/ação da tela (idempotente) ---------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
 ('pm.ia_preco.tela', 'Preço Ótimo', 'Preço sugerido',
  'Tela que sugere o preço do job a partir do custo real e da margem que você quer.',
  'Tira o preço do achismo: usa o custo apurado de jobs parecidos (horas × custo/hora) e a margem-alvo para propor um preço com base em dado.',
  'Sugerir o preço de um novo job de "Gestão de redes".',
  'Sem custo/hora da equipe apontado, o custo sai zerado — cadastre o custo/hora na tela Equipe.',
  10, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.servico', 'Preço Ótimo', 'Serviço',
  'Escolha o serviço do job que você vai precificar (ou deixe "Toda a carteira" para a média geral).',
  'Define quais jobs do histórico entram na conta: o cálculo usa os jobs do mesmo serviço para estimar o custo.',
  'Gestão de redes · Social media · Tráfego pago.',
  'Escolher um serviço sem histórico de jobs — nesse caso a conta cai para o tipo ou para a carteira toda.',
  20, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.margem', 'Preço Ótimo', 'Margem-alvo (%)',
  'A margem que você quer ganhar sobre o preço de venda (em %). Em branco, usa a margem cadastrada do serviço, depois a geral da empresa, senão 30%.',
  'É o quanto do preço fica de lucro: o preço é calculado como custo ÷ (1 − margem). Margem maior → preço maior.',
  '35 para 35% de margem.',
  'Informar acima de 95% deixa o preço irreal — a conta trava em 95%.',
  30, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.custo_base', 'Preço Ótimo', 'Custo base',
  'Indicador: o custo médio apurado dos jobs semelhantes (horas apontadas × custo/hora). Quando não há custo real, usa o custo estimado.',
  'É a base do preço: o preço sugerido é esse custo dividido por (1 − margem).',
  'R$ 1.200,00 (real) ou R$ 900,00 (estimado).',
  'Custo "estimado" significa que ainda faltam apontamentos de hora — aponte as horas para fechar no custo real.',
  40, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.preco_sugerido', 'Preço Ótimo', 'Preço sugerido',
  'Indicador: o preço proposto pela conta (custo base ÷ (1 − margem-alvo)).',
  'É o número que você leva para a proposta — ajuste se quiser e use no orçamento.',
  'Custo R$ 1.000 e margem 30% → preço R$ 1.428,57.',
  'Fechar abaixo desse preço reduz a margem; acima, pode perder o cliente.',
  50, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.lucro', 'Preço Ótimo', 'Lucro estimado',
  'Indicador: preço sugerido menos o custo base.',
  'Mostra em reais quanto sobra no preço sugerido depois de pagar o custo.',
  'Preço R$ 1.428 − custo R$ 1.000 = R$ 428 de lucro.',
  'Lucro baixo com margem alta é sinal de custo base subestimado.',
  60, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.markup', 'Preço Ótimo', 'Markup',
  'Indicador: quanto o preço está acima do custo, em %.',
  'Ajuda a comparar com a prática do mercado: margem de 30% equivale a um markup de ~43%.',
  'Custo R$ 1.000 e preço R$ 1.430 → markup 43%.',
  'Confundir markup (sobre o custo) com margem (sobre o preço) — são números diferentes.',
  70, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.horas', 'Preço Ótimo', 'Horas médias',
  'Indicador: média de horas apontadas nos jobs semelhantes.',
  'Mostra o esforço típico do serviço — ajuda a conferir se o custo base faz sentido.',
  '18,5 h por job.',
  'Poucos jobs no histórico deixam a média instável — veja a base histórica ao lado.',
  80, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.valor_praticado', 'Preço Ótimo', 'Valor médio praticado',
  'Indicador: média do valor_job cobrado nos jobs semelhantes do histórico.',
  'Serve de comparação: o preço sugerido ao lado do que você já vem cobrando.',
  'Praticado R$ 1.300 × sugerido R$ 1.430.',
  'Valor praticado bem abaixo do sugerido pode indicar que você está cobrando pouco.',
  90, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.n_jobs', 'Preço Ótimo', 'Base histórica',
  'Indicador: quantos jobs entraram na conta (com custo real e com custo estimado).',
  'Quanto mais jobs, mais confiável a sugestão.',
  '7 jobs (5 com custo real, 2 estimados).',
  'Base com 1–2 jobs é frágil — trate o preço como ponto de partida.',
  100, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.usar_proposta', 'Preço Ótimo', 'Usar na proposta',
  'Botão que leva o preço sugerido para a tela de Propostas.',
  'Fecha a jornada: do preço sugerido direto para o orçamento do cliente.',
  'Clicar para abrir Propostas já com o serviço e o preço em mãos.',
  'Sem serviço escolhido o preço vai como média geral — confira antes de enviar ao cliente.',
  110, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.margem_alvo_lista', 'Preço Ótimo', 'Margens-alvo',
  'Lista das margens-alvo cadastradas: a geral da empresa e as por serviço.',
  'É a margem que a tela aplica quando você não digita uma: por serviço tem prioridade sobre a geral.',
  'Geral 30% · Social media 40%.',
  'Sem nenhuma cadastrada, a tela usa 30% como padrão.',
  120, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.margem_alvo_salvar', 'Preço Ótimo', 'Salvar margem-alvo',
  'Botão para cadastrar/alterar a margem-alvo (geral ou do serviço escolhido).',
  'Guarda a margem para a empresa toda ou para um serviço, de forma rastreável (quem alterou e quando).',
  'Salvar 40% para "Social media".',
  'Salvar sem escolher serviço altera a margem GERAL da empresa.',
  130, '/dashboard/pm/ia-preco', 'pm', 'publicado'),
 ('pm.ia_preco.margem_alvo_excluir', 'Preço Ótimo', 'Excluir margem-alvo',
  'Botão para excluir uma margem-alvo cadastrada.',
  'Remove a margem de forma rastreável (soft-delete + audit): a tela volta a usar a margem geral ou o padrão.',
  'Excluir a margem de um serviço descontinuado.',
  'Excluir a GERAL faz a tela cair para 30% — cadastre outra se quiser um padrão diferente.',
  140, '/dashboard/pm/ia-preco', 'pm', 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- (6) Seed DEMO (idempotente): margem-alvo geral 35% na empresa DEMO P&M, para a jornada rodar com dado real (RD-38).
INSERT INTO public.agency_margem_alvo (company_id, servico_id, margem_pct, observacao)
SELECT 'b0700000-0000-4000-a000-000000000002'::uuid, NULL, 35,
       'Margem-alvo padrão da agência DEMO (seed).'
WHERE EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000002'::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM public.agency_margem_alvo
     WHERE company_id = 'b0700000-0000-4000-a000-000000000002'::uuid AND servico_id IS NULL AND deleted_at IS NULL);
