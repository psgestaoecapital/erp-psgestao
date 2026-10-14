-- Aba Codes · gráficos (fatia 3): chamados resolvidos por dia (CEO 09/10). Faixa 05. Aditiva: função NOVA só de leitura + "?".
-- Fonte: public.sugestoes (status 'concluida', data = concluido_em no fuso de São Paulo). Só equipe PS (fn_dev_painel_pode_ver).
CREATE OR REPLACE FUNCTION public.fn_dev_codes_chamados_por_dia(p_dias integer DEFAULT 7)
RETURNS TABLE(dia date, resolvidos integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  p_dias := LEAST(GREATEST(COALESCE(p_dias, 7), 1), 90);
  RETURN QUERY
  SELECT d::date, COALESCE(c.n, 0)::integer
  FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - (p_dias - 1), (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day') d
  LEFT JOIN (
    SELECT (concluido_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, count(*) AS n
    FROM public.sugestoes
    WHERE status = 'concluida' AND concluido_em >= now() - make_interval(days => p_dias + 1)
    GROUP BY 1) c ON c.dia = d::date
  ORDER BY 1;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_dev_codes_chamados_por_dia(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_codes_chamados_por_dia(integer) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'dev.codes.graficos.chamados', 'Codes', 'Chamados resolvidos por dia', 'Nada a preencher: conta os chamados concluídos em cada dia, no fuso de São Paulo, dentro do período escolhido.', 'Mostra o ritmo de atendimento dos chamados e se a equipe está dando conta da fila.', 'Barra de 6 no dia 10: seis chamados foram concluídos naquele dia.', 'Esperar que chamados arquivados entrem: só contam os concluídos.', 17, '/dashboard/dev/codes', 'dev', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
