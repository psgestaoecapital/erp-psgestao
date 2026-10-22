-- Painel de Codes · "Chamados resolvidos por dia" com duas colunas (CEO 16/10, tarefa cd0254ee). Faixa 00. Aditiva (RD-97):
-- funções NOVAS só de leitura; a fn_dev_codes_chamados_por_dia existente fica intacta. Só equipe PS (fn_dev_painel_pode_ver).
-- Não há histórico de status dos chamados: "resolvido pela PS" = resposta aprovada (resposta_aprovada_em) em chamado hoje
-- aguardando_confirmacao ou concluida; "confirmado" = concluida no dia (concluido_em); concluída sem confirmação do cliente
-- (encerrado_sem_confirmacao) sai em coluna própria. Ficam de fora robôs/teste: interno, cliente-demo, e-mail de robô/vigia.
CREATE OR REPLACE FUNCTION public.fn_dev_codes_chamados_ps_x_cliente(p_dias integer DEFAULT 7)
RETURNS TABLE(dia date, resolvidos_ps integer, confirmados_cliente integer, automaticos integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  p_dias := LEAST(GREATEST(COALESCE(p_dias, 7), 1), 90);
  RETURN QUERY
  WITH base AS (
    SELECT s.status, s.resposta_aprovada_em, s.concluido_em, COALESCE(s.encerrado_sem_confirmacao, false) AS auto
    FROM public.sugestoes s
    WHERE s.status IN ('aguardando_confirmacao', 'concluida')
      AND COALESCE(s.interno, false) = false
      AND COALESCE(s.user_email, '') !~* 'robo|aceit|vigia|demo|e2e'
      AND (s.resposta_aprovada_em >= now() - make_interval(days => p_dias + 1) OR s.concluido_em >= now() - make_interval(days => p_dias + 1))
  ), ps AS (
    SELECT (resposta_aprovada_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, count(*) AS n FROM base WHERE resposta_aprovada_em IS NOT NULL GROUP BY 1
  ), cli AS (
    SELECT (concluido_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, count(*) FILTER (WHERE NOT auto) AS n, count(*) FILTER (WHERE auto) AS a
    FROM base WHERE status = 'concluida' AND concluido_em IS NOT NULL GROUP BY 1
  )
  SELECT d::date, COALESCE(ps.n, 0)::integer, COALESCE(cli.n, 0)::integer, COALESCE(cli.a, 0)::integer
  FROM generate_series((now() AT TIME ZONE 'America/Sao_Paulo')::date - (p_dias - 1), (now() AT TIME ZONE 'America/Sao_Paulo')::date, interval '1 day') d
  LEFT JOIN ps ON ps.dia = d::date LEFT JOIN cli ON cli.dia = d::date
  ORDER BY 1;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_dev_codes_chamados_ps_x_cliente(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_codes_chamados_ps_x_cliente(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_dev_codes_chamados_esperando_cliente()
RETURNS TABLE(esperando integer, mais_antigo_dias integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  RETURN QUERY
  SELECT count(*)::integer,
         COALESCE(max(floor(extract(epoch FROM now() - COALESCE(s.resposta_aprovada_em, s.updated_at)) / 86400)), 0)::integer
  FROM public.sugestoes s
  WHERE s.status = 'aguardando_confirmacao'
    AND COALESCE(s.interno, false) = false
    AND COALESCE(s.user_email, '') !~* 'robo|aceit|vigia|demo|e2e';
END $fn$;
REVOKE ALL ON FUNCTION public.fn_dev_codes_chamados_esperando_cliente() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_codes_chamados_esperando_cliente() TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'dev.codes.graficos.chamados_espera', 'Codes', 'Chamados esperando o cliente', 'Nada a preencher: mostra quantos chamados já foram respondidos pela PS e aguardam a confirmação do cliente, e há quantos dias o mais antigo espera.', 'Mostra a fila que depende do cliente para fechar, separada da que depende da PS.', '58 esperando, o mais antigo há 19 dias: o cliente ainda não confirmou nem reabriu.', 'Achar que são chamados abertos pela PS: a PS já respondeu, falta a confirmação do cliente.', 18, '/dashboard/dev/codes', 'dev', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
UPDATE public.erp_ajuda_campo SET
  o_que_preencher = 'Nada a preencher: por dia, a coluna "Resolvidos pela PS" conta os chamados que a PS respondeu (aprovou a resposta) e passaram a aguardar o cliente; "Confirmados pelo cliente" conta os concluídos no dia; "Automáticos" os encerrados sem confirmação. Fuso de São Paulo.',
  para_que_serve = 'Separa o trabalho da PS do fechamento pelo cliente: o ritmo de atendimento e quanto ainda espera confirmação. Chamados de robô, teste, demo e internos não entram.',
  exemplo = 'Dia 16: 14 resolvidos pela PS e 1 confirmado pelo cliente.',
  erro_comum = 'Esperar que o dia da coluna da PS siga o histórico de status: ele usa a data da resposta aprovada.'
WHERE chave = 'dev.codes.graficos.chamados';
