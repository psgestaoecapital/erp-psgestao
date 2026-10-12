-- Pdois (Marciana, 07/10): a #2171 resolvia o nome em public.users, mas fn_pauta_listar é SECURITY INVOKER e a RLS de users
-- esconde o Edney da Marciana -> responsavel seguia null. Passa a ler o nome por fn_usuarios_da_empresa (SECURITY DEFINER,
-- guarda por empresa, só usuários vinculados à MESMA empresa), chamada uma vez por listagem. Função continua INVOKER.
CREATE OR REPLACE FUNCTION public.fn_pauta_listar(p_company_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb, p_situacao text DEFAULT NULL::text, p_agrupar text DEFAULT 'prazo'::text, p_pagina integer DEFAULT 1, p_por_pagina integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_margem boolean; v_por int := LEAST(GREATEST(COALESCE(p_por_pagina, 50), 1), 500); v_pag int := GREATEST(COALESCE(p_pagina, 1), 1);
        v_total bigint; v_itens jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_margem := public.fn_pm_pode_ver_margem(p_company_id);
  SELECT count(*) INTO v_total FROM public.fn__pauta_filtrar(p_company_id, p_filtros) j WHERE p_situacao IS NULL OR j.status = p_situacao;
  WITH h AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date hoje),
  base AS (
    SELECT j.*, c.nome_fantasia AS cli_fantasia, c.nome AS cli_nome, c.status AS cli_status, s.nome AS servico_nome,
           COALESCE(
             (SELECT e.nome FROM public.agency_equipe e WHERE e.company_id = j.company_id AND e.user_id = j.responsavel_id LIMIT 1),
             (SELECT NULLIF(btrim(u.full_name), '') FROM public.fn_usuarios_da_empresa(p_company_id) u WHERE u.id = j.responsavel_id)) AS equipe_nome,
           (SELECT i.ajustes_limite FROM public.agency_contrato_itens i
             WHERE i.contrato_id = j.contrato_id AND i.servico_id = j.servico_id AND i.ajustes_limite IS NOT NULL LIMIT 1) AS limite,
           (j.data_prazo::date < h.hoje AND j.status NOT IN ('concluida', 'publicado')) AS atrasado,
           (h.hoje - j.data_prazo::date) AS dias_atraso
      FROM public.fn__pauta_filtrar(p_company_id, p_filtros) j
      LEFT JOIN public.agency_clientes c ON c.id = j.cliente_id
      LEFT JOIN public.agency_servico s ON s.id = j.servico_id
      CROSS JOIN h
     WHERE p_situacao IS NULL OR j.status = p_situacao),
  pagina AS (
    SELECT * FROM base
     ORDER BY
       CASE WHEN p_agrupar IN ('prazo', 'sem') THEN NOT atrasado END,
       CASE WHEN p_agrupar = 'cliente' THEN COALESCE(cli_fantasia, cli_nome) END,
       CASE WHEN p_agrupar = 'responsavel' THEN COALESCE(equipe_nome, responsavel_nome) END,
       data_prazo NULLS LAST, numero
     OFFSET (v_pag - 1) * v_por LIMIT v_por)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'numero', p.numero,
           'codigo', p.numero || CASE WHEN p.rodada_ajuste BETWEEN 1 AND 26 THEN chr(64 + p.rodada_ajuste) WHEN p.rodada_ajuste > 26 THEN 'Z' ELSE '' END,
           'rodada', p.rodada_ajuste, 'titulo', p.titulo, 'status', p.status, 'prioridade', p.prioridade, 'nota', p.nota,
           'data_prazo', p.data_prazo, 'atrasado', COALESCE(p.atrasado, false), 'dias_atraso', CASE WHEN p.atrasado THEN p.dias_atraso END,
           'cliente_id', p.cliente_id, 'cliente', COALESCE(p.cli_fantasia, p.cli_nome), 'cliente_status', p.cli_status,
           'responsavel_id', p.responsavel_id, 'responsavel', COALESCE(p.equipe_nome, p.responsavel_nome),
           'servico', p.servico_nome, 'tipo', p.tipo,
           'tem_anexo', (jsonb_typeof(p.arquivos) = 'array' AND jsonb_array_length(p.arquivos) > 0),
           'tem_link', (COALESCE(p.arquivos::text, '') ~* 'https?://'),
           'comentarios_novos', (SELECT count(*) FROM public.agency_job_comentarios k
                                  WHERE k.job_id = p.id AND k.excluido_em IS NULL AND k.autor_id IS DISTINCT FROM auth.uid()
                                    AND k.criado_em > COALESCE((SELECT v.visto_em FROM public.agency_job_visto v
                                                                 WHERE v.job_id = p.id AND v.user_id = auth.uid()), '-infinity'::timestamptz)),
           'aguardando_de', p.aguardando_de, 'aguardando_motivo', p.aguardando_motivo,
           'aguardando_dias', CASE WHEN p.status = 'aguardando' AND p.aguardando_desde IS NOT NULL
                                   THEN ((now() AT TIME ZONE 'America/Sao_Paulo')::date - p.aguardando_desde::date) END,
           'ajustes_limite', p.limite,
           'escopo_estourou', (p.limite IS NOT NULL AND p.rodada_ajuste > p.limite),
           'excluido_em', p.excluido_em,
           'valor_job', CASE WHEN v_margem THEN p.valor_job END,
           'custo', CASE WHEN v_margem THEN COALESCE(p.custo_real, p.custo_estimado) END,
           'margem', CASE WHEN v_margem AND COALESCE(p.valor_job, 0) > 0
                          THEN p.valor_job - COALESCE(p.custo_real, p.custo_estimado, 0) END)), '[]'::jsonb)
    INTO v_itens
    FROM pagina p;
  RETURN jsonb_build_object('total', v_total, 'pagina', v_pag, 'por_pagina', v_por, 'pode_ver_margem', v_margem, 'itens', v_itens);
END $function$;
