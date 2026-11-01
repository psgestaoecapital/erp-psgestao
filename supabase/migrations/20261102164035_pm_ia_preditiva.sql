-- PDCA P&M (auditor_pdca_2) · /dashboard/pm/ia-preditiva (IA Preditiva) — TIRA A TELA DO PREVIEW (RD-98 p1).
-- Code: code-desenvolvedor-3 · 01/11
--
-- A tela era ModuloPreview (8 linhas) = TELA MORTA (RD-98 p1). Esta migration ADITIVA cria a camada de dados da tela
-- REAL de previsões acionáveis, a partir de DADO REAL (RD-38): jobs atrasados / em risco de atraso (prazo × ritmo),
-- horas estouradas (realizado > estimado), margem em risco (custo já perto do valor) e sobrecarga de equipe (muitos
-- jobs ativos sob a mesma pessoa). Cada previsão aponta para o registro real. Leitura pura (sem CRUD): não há entidade
-- persistida, logo RD-98 p2/p4 não se aplica aqui. Guarda de empresa + REVOKE anon. Nada existente é alterado.

CREATE OR REPLACE FUNCTION public.fn_pm_previsoes(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_prev jsonb; v_sobre jsonb; v_all jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  WITH j AS (
    SELECT jb.id, jb.titulo, jb.status, jb.data_prazo, jb.responsavel_id, jb.responsavel_nome,
           COALESCE(jb.horas_estimadas, 0) AS he, COALESCE(jb.horas_realizadas, 0) AS hr,
           COALESCE(jb.valor_job, 0) AS vj, COALESCE(jb.custo_estimado, 0) AS ce,
           (jb.status NOT IN ('concluida','publicado','entregue','finalizado','cancelado','arquivado')) AS ativo
      FROM public.agency_jobs jb
     WHERE jb.company_id = p_company_id AND jb.excluido_em IS NULL
  ), custos AS (
    SELECT c.job_id, sum(c.custo_total) AS custo_real
      FROM public.fn_pm_job_custos(p_company_id) c JOIN j ON j.id = c.job_id
     GROUP BY c.job_id
  ), base AS (
    SELECT j.*, COALESCE(cu.custo_real, 0) AS custo_real,
           CASE WHEN j.he > 0 THEN round(j.hr / j.he * 100) ELSE NULL END AS prog
      FROM j LEFT JOIN custos cu ON cu.job_id = j.id
  ), prev AS (
    SELECT 'atraso' AS categoria, 'alto' AS severidade, 2 AS ord, b.data_prazo,
           'Atrasado: ' || COALESCE(b.titulo, '(sem título)') AS titulo,
           'Prazo venceu em ' || to_char(b.data_prazo, 'DD/MM') || ' · status ' || b.status
             || COALESCE(' · ' || b.prog || '% das horas', '') AS detalhe,
           'job' AS ref_tipo, b.id AS ref_id, '/dashboard/pm/painel-jobs' AS rota
      FROM base b WHERE b.ativo AND b.data_prazo IS NOT NULL AND b.data_prazo < current_date
    UNION ALL
    SELECT 'atraso', 'medio', 3, b.data_prazo,
           'Risco de atraso: ' || COALESCE(b.titulo, '(sem título)'),
           'Vence em ' || to_char(b.data_prazo, 'DD/MM') || ' e só ' || COALESCE(b.prog, 0) || '% das horas foram feitas',
           'job', b.id, '/dashboard/pm/painel-jobs'
      FROM base b WHERE b.ativo AND b.data_prazo IS NOT NULL
        AND b.data_prazo >= current_date AND b.data_prazo <= current_date + 7 AND COALESCE(b.prog, 0) < 70
    UNION ALL
    SELECT 'horas', 'alto', 1, b.data_prazo,
           'Horas estouradas: ' || COALESCE(b.titulo, '(sem título)'),
           b.hr || ' h feitas de ' || b.he || ' h estimadas',
           'job', b.id, '/dashboard/pm/painel-jobs'
      FROM base b WHERE b.ativo AND b.he > 0 AND b.hr > b.he * 1.1
    UNION ALL
    SELECT 'margem', 'medio', 4, b.data_prazo,
           'Margem em risco: ' || COALESCE(b.titulo, '(sem título)'),
           'Custo já em ' || round(GREATEST(b.custo_real, b.ce) / NULLIF(b.vj, 0) * 100) || '% do valor do job',
           'job', b.id, '/dashboard/pm/painel-jobs'
      FROM base b WHERE b.ativo AND b.vj > 0 AND GREATEST(b.custo_real, b.ce) > b.vj * 0.8
  )
  SELECT jsonb_agg(jsonb_build_object(
           'categoria', categoria, 'severidade', severidade, 'titulo', titulo, 'detalhe', detalhe,
           'ref_tipo', ref_tipo, 'ref_id', ref_id, 'rota', rota))
    INTO v_prev
    FROM (SELECT * FROM prev ORDER BY ord, data_prazo NULLS LAST LIMIT 100) q;

  -- Sobrecarga de equipe: 8+ jobs ativos atrasados ou a vencer em 14 dias sob a mesma pessoa.
  WITH j AS (
    SELECT jb.responsavel_id, jb.responsavel_nome, jb.data_prazo,
           (jb.status NOT IN ('concluida','publicado','entregue','finalizado','cancelado','arquivado')) AS ativo
      FROM public.agency_jobs jb WHERE jb.company_id = p_company_id AND jb.excluido_em IS NULL
  ), agg AS (
    SELECT responsavel_id, max(responsavel_nome) AS nome, count(*) AS n
      FROM j WHERE ativo AND responsavel_id IS NOT NULL
        AND (data_prazo IS NULL OR data_prazo <= current_date + 14)
     GROUP BY responsavel_id HAVING count(*) >= 8
  )
  SELECT jsonb_agg(jsonb_build_object(
           'categoria', 'sobrecarga', 'severidade', 'alto',
           'titulo', 'Sobrecarga: ' || COALESCE(nome, '(sem responsável)'),
           'detalhe', n || ' jobs ativos atrasados ou a vencer sob a mesma pessoa',
           'ref_tipo', 'pessoa', 'ref_id', responsavel_id, 'rota', '/dashboard/pm/painel-gestor')
           ORDER BY n DESC)
    INTO v_sobre FROM agg;

  v_all := COALESCE(v_prev, '[]'::jsonb) || COALESCE(v_sobre, '[]'::jsonb);
  RETURN jsonb_build_object(
    'ok', true, 'gerado_em', now(),
    'resumo', jsonb_build_object(
       'total', jsonb_array_length(v_all),
       'alto',  (SELECT count(*) FROM jsonb_array_elements(v_all) e WHERE e->>'severidade' = 'alto'),
       'medio', (SELECT count(*) FROM jsonb_array_elements(v_all) e WHERE e->>'severidade' = 'medio')),
    'previsoes', v_all);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pm_previsoes(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_previsoes(uuid) TO authenticated, service_role;

-- RD-98 p3 · origem do dado
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_jobs','agency_timesheet','agency_tarefas']::text[],
       rpcs_chamadas    = ARRAY['fn_pm_previsoes','fn_ajuda_campo_listar']::text[]
 WHERE rota = '/dashboard/pm/ia-preditiva';

-- RD-95 · "?" de cada indicador/filtro/ação (idempotente)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
 ('pm.ia_preditiva.tela', 'Preditiva', 'Previsões',
  'Tela que antecipa problemas da operação: atraso, horas estouradas, margem em risco e sobrecarga de equipe.',
  'Em vez de descobrir depois, você age antes: cada previsão sai do dado real dos jobs e aponta para o registro.',
  'Ver os jobs que vão atrasar esta semana.',
  'Previsão não é certeza — é um alerta para você conferir o job.',
  10, '/dashboard/pm/ia-preditiva', 'pm', 'publicado'),
 ('pm.ia_preditiva.resumo', 'Preditiva', 'Resumo (alto / médio)',
  'Indicador: quantas previsões há no total e quantas de severidade alta e média.',
  'Mostra o tamanho do problema de um relance; priorize as de severidade alta.',
  '5 altas · 8 médias · 13 no total.',
  'Resumo zerado não garante tudo certo — pode faltar prazo/horas nos jobs.',
  20, '/dashboard/pm/ia-preditiva', 'pm', 'publicado'),
 ('pm.ia_preditiva.filtro', 'Preditiva', 'Filtrar por tipo',
  'Filtro: mostra só as previsões de um tipo (atraso, horas, margem, sobrecarga).',
  'Ajuda a focar num tipo de risco de cada vez.',
  'Filtrar só "Atraso".',
  'Esquecer o filtro ligado e achar que não há outros riscos.',
  30, '/dashboard/pm/ia-preditiva', 'pm', 'publicado'),
 ('pm.ia_preditiva.severidade', 'Preditiva', 'Severidade',
  'Indicador por previsão: alto (já é problema) ou médio (risco a acompanhar).',
  'Define a ordem de ação: resolva primeiro as de severidade alta.',
  'Atrasado = alto; risco de atraso = médio.',
  'Tratar médio com a mesma urgência que alto e perder o foco.',
  40, '/dashboard/pm/ia-preditiva', 'pm', 'publicado'),
 ('pm.ia_preditiva.atraso', 'Preditiva', 'Atraso',
  'Previsão: job já atrasado (prazo vencido) ou em risco de atraso (vence em até 7 dias com poucas horas feitas).',
  'Antecipa o estouro de prazo para você redistribuir ou renegociar antes.',
  'Vence em 05/11 e só 20% das horas foram feitas.',
  'Deixar o prazo vencer antes de agir.',
  50, '/dashboard/pm/ia-preditiva', 'pm', 'publicado'),
 ('pm.ia_preditiva.horas', 'Preditiva', 'Horas estouradas',
  'Previsão: o job já consumiu mais horas do que o estimado.',
  'Mostra que o custo subiu — reveja o escopo ou o preço antes de fechar no prejuízo.',
  '30 h feitas de 20 h estimadas.',
  'Seguir apontando horas sem rever o escopo com o cliente.',
  60, '/dashboard/pm/ia-preditiva', 'pm', 'publicado'),
 ('pm.ia_preditiva.margem', 'Preditiva', 'Margem em risco',
  'Previsão: o custo (real ou estimado) já passou de 80% do valor do job.',
  'Avisa que a margem está apertada antes de acabar o lucro.',
  'Custo já em 85% do valor do job.',
  'Descobrir o prejuízo só no fechamento.',
  70, '/dashboard/pm/ia-preditiva', 'pm', 'publicado'),
 ('pm.ia_preditiva.sobrecarga', 'Preditiva', 'Sobrecarga de equipe',
  'Previsão: muitos jobs ativos (atrasados ou a vencer) sob a mesma pessoa.',
  'Aponta gargalo de pessoa para você redistribuir a carga.',
  '12 jobs ativos sob o mesmo responsável.',
  'Concentrar tudo numa pessoa e virar gargalo.',
  80, '/dashboard/pm/ia-preditiva', 'pm', 'publicado'),
 ('pm.ia_preditiva.abrir', 'Preditiva', 'Abrir registro',
  'Ação: abre o job ou o painel da pessoa ligado à previsão.',
  'Leva direto ao registro real para você agir (redistribuir, renegociar prazo).',
  'Clicar para abrir o job atrasado no painel.',
  'Agir sem abrir o registro e conferir a situação real.',
  90, '/dashboard/pm/ia-preditiva', 'pm', 'publicado')
ON CONFLICT (chave) DO NOTHING;
