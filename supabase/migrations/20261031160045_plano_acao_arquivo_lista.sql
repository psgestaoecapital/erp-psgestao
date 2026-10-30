-- Plano de Ação 5W2H (Indústria): ARQUIVO automático (nunca exclui, RD-30), "incluir arquivadas" e % no prazo correto.
-- Aditivo: 3 colunas novas em erp_plano_acao + RPC de arquivar + listar com p_incluir_arquivadas + resumo corrigido.
ALTER TABLE public.erp_plano_acao
  ADD COLUMN IF NOT EXISTS arquivada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS arquivada_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivada_por uuid;

-- Concluída/cancelada há mais de 30 dias vai para o ARQUIVO (flag + quem/quando). Idempotente; auth.uid() nulo = rotina.
CREATE OR REPLACE FUNCTION public.fn_plano_acao_arquivar_antigas(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  UPDATE erp_plano_acao SET arquivada = true, arquivada_em = now(), arquivada_por = auth.uid()
   WHERE company_id = p_company_id AND excluido_em IS NULL AND NOT arquivada
     AND status IN ('concluida','cancelada')
     AND coalesce(concluida_em, atualizado_em) < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'arquivadas',n);
END $$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_arquivar_antigas(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_arquivar_antigas(uuid) TO authenticated;

-- Listar: troca a assinatura (sem sobrecarga ambígua) para aceitar p_incluir_arquivadas.
DROP FUNCTION IF EXISTS public.fn_plano_acao_listar(uuid, text, uuid, uuid, text, text, boolean, text, uuid);
CREATE OR REPLACE FUNCTION public.fn_plano_acao_listar(p_company_id uuid, p_status text DEFAULT NULL::text, p_responsavel uuid DEFAULT NULL::uuid, p_setor uuid DEFAULT NULL::uuid, p_prioridade text DEFAULT NULL::text, p_origem text DEFAULT NULL::text, p_so_atrasadas boolean DEFAULT false, p_busca text DEFAULT NULL::text, p_reuniao uuid DEFAULT NULL::uuid, p_incluir_arquivadas boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; q text := nullif(btrim(p_busca),'');
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT jsonb_agg(row_to_json(a) ORDER BY a.prazo_ord NULLS LAST, a.criado_em DESC) INTO v FROM (
    SELECT pa.id, pa.codigo, pa.titulo, pa.o_que, pa.por_que, pa.onde, pa.setor_id, s.nome AS setor_nome,
           pa.quando, pa.responsavel_user_id, pa.responsavel_nome, pa.como, pa.custo_estimado, pa.custo_real,
           pa.status, pa.prioridade, pa.origem, pa.origem_ref, pa.indicador_vinculado, pa.resultado_obtido,
           pa.reuniao_id, re.codigo AS reuniao_codigo, re.titulo AS reuniao_titulo,
           pa.concluida_em, pa.criado_em, pa.atualizado_em,
           (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')) AS atrasada,
           pa.arquivada, pa.arquivada_em,
           pa.quando AS prazo_ord
    FROM erp_plano_acao pa
    LEFT JOIN prod_setor s ON s.id = pa.setor_id
    LEFT JOIN erp_plano_acao_reuniao re ON re.id = pa.reuniao_id
    WHERE pa.company_id = p_company_id AND pa.excluido_em IS NULL
      AND (p_incluir_arquivadas OR NOT pa.arquivada)
      AND (p_status IS NULL OR pa.status = p_status)
      AND (p_responsavel IS NULL OR pa.responsavel_user_id = p_responsavel)
      AND (p_setor IS NULL OR pa.setor_id = p_setor)
      AND (p_prioridade IS NULL OR pa.prioridade = p_prioridade)
      AND (p_origem IS NULL OR pa.origem = p_origem)
      AND (p_reuniao IS NULL OR pa.reuniao_id = p_reuniao)
      AND (NOT p_so_atrasadas OR (pa.quando IS NOT NULL AND pa.quando < current_date AND pa.status NOT IN ('concluida','cancelada')))
      AND (q IS NULL OR pa.titulo ILIKE '%'||q||'%' OR pa.codigo ILIKE '%'||q||'%'
           OR coalesce(pa.o_que,'') ILIKE '%'||q||'%' OR coalesce(pa.responsavel_nome,'') ILIKE '%'||q||'%'
           OR coalesce(pa.origem_ref,'') ILIKE '%'||q||'%' OR coalesce(re.titulo,'') ILIKE '%'||q||'%' OR coalesce(re.codigo,'') ILIKE '%'||q||'%')
  ) a;
  RETURN jsonb_build_object('ok',true,'resultados',coalesce(v,'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid,boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_listar(uuid,text,uuid,uuid,text,text,boolean,text,uuid,boolean) TO authenticated;

-- Resumo: "% no prazo" compara o dia da conclusão no fuso de Brasília (antes ::date em UTC jogava a conclusão
-- da noite para o dia seguinte e zerava o índice) e conta também as arquivadas (são o histórico do índice).
CREATE OR REPLACE FUNCTION public.fn_plano_acao_resumo(p_company_id uuid, p_reuniao uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_abertas int; v_andamento int; v_atrasadas int; v_concluidas_mes int; v_no_prazo int; v_concl_prazo_base int; v_pct numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','nao_autenticado'); END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem_acesso'); END IF;
  SELECT
    count(*) FILTER (WHERE status = 'aberta'),
    count(*) FILTER (WHERE status = 'em_andamento'),
    count(*) FILTER (WHERE quando IS NOT NULL AND quando < current_date AND status NOT IN ('concluida','cancelada')),
    count(*) FILTER (WHERE status = 'concluida' AND concluida_em >= date_trunc('month', now())),
    count(*) FILTER (WHERE status = 'concluida' AND quando IS NOT NULL AND (concluida_em AT TIME ZONE 'America/Sao_Paulo')::date <= quando),
    count(*) FILTER (WHERE status = 'concluida' AND quando IS NOT NULL)
  INTO v_abertas, v_andamento, v_atrasadas, v_concluidas_mes, v_no_prazo, v_concl_prazo_base
  FROM erp_plano_acao WHERE company_id = p_company_id AND excluido_em IS NULL
    AND (p_reuniao IS NULL OR reuniao_id = p_reuniao);
  v_pct := CASE WHEN v_concl_prazo_base > 0 THEN round(100.0 * v_no_prazo / v_concl_prazo_base, 1) ELSE NULL END;
  RETURN jsonb_build_object('ok',true,'abertas',v_abertas,'em_andamento',v_andamento,'atrasadas',v_atrasadas,
    'concluidas_mes',v_concluidas_mes,'pct_no_prazo',v_pct);
END $function$;
REVOKE ALL ON FUNCTION public.fn_plano_acao_resumo(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_plano_acao_resumo(uuid, uuid) TO authenticated;

-- "?" (RD-95) dos controles novos.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Plano de Ação 5W2H', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/industrial/plano-acao', 'industrial', 'publicado'
FROM (VALUES
 ('industrial.plano_acao.incluir_arquivadas','Incluir arquivadas','Marque para ver também as ações já arquivadas.','Concluída ou cancelada há mais de 30 dias sai sozinha do quadro e da tabela e vai para o arquivo. Nada é excluído: aqui você consulta o histórico.','Procurar a ação PA-2026-0003, concluída em setembro.','Esquecer a marca e achar que a ação sumiu: ela está no arquivo.',31),
 ('industrial.plano_acao.ordenar','Ordenar a tabela','Clique no título de uma coluna para ordenar; clique de novo para inverter.','Deixa as ações na ordem que a reunião precisa (prazo, responsável, prioridade).','Clicar em "Prazo" para ver as mais urgentes primeiro.','Achar que o filtro mudou: a ordem não filtra, só organiza.',32),
 ('industrial.plano_acao.exportar_csv','Exportar CSV','Baixa as ações que estão na tela (respeita os filtros e a marca de arquivadas).','Abre no Excel ou em qualquer planilha para conferir ou compartilhar.','Filtrar "Só atrasadas" e baixar a lista para a reunião.','Esperar todas as ações: só vai o que passa nos filtros.',33)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
