-- Mapa da Infra · alerta ao CEO (nó vermelho) + fila de chamados por Code (CEO 14/10). Só funções novas + agendamento.
-- Alerta pelo canal do briefing (erp_truth_alerts), um por nó enquanto o anterior estiver aberto.

CREATE OR REPLACE FUNCTION public.fn_infra_alerta_verificar()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: rotina interna de alerta (pg_cron), sem parâmetro, só service_role
DECLARE n RECORD; v_qtd int := 0;
BEGIN
  FOR n IN
    SELECT nn.chave, nn.nome, nn.cadencia_min, nn.tolerancia_min,
      CASE nn.fonte
        WHEN 'cron' THEN (SELECT max(d.start_time) FROM cron.job_run_details d
                           WHERE d.jobid = (SELECT jobid FROM cron.job j WHERE j.jobname = nn.fonte_ref LIMIT 1)
                             AND d.start_time > now() - interval '2 days')
        WHEN 'batimento' THEN (SELECT max(b.criado_em) FROM erp_infra_batimento b WHERE b.no_chave = nn.chave)
      END AS ult
    FROM erp_infra_no nn WHERE nn.ativo AND nn.cadencia_min IS NOT NULL AND nn.fonte IN ('cron','batimento')
  LOOP
    IF n.ult IS NULL OR extract(epoch FROM now() - n.ult)/60 > n.cadencia_min + COALESCE(n.tolerancia_min, 0) THEN
      IF NOT EXISTS (SELECT 1 FROM erp_truth_alerts WHERE rule_id = 'infra_no_' || n.chave AND status = 'novo') THEN
        INSERT INTO erp_truth_alerts (rule_id, severity, area, tipo_divergencia, mensagem, recomendacao, status)
        VALUES ('infra_no_' || n.chave, 'high', 'dev', 'infra_no_parado',
                'Mapa da Infra: "' || n.nome || '" fora da tolerância (cadência ' || n.cadencia_min || ' min, tolerância '
                  || COALESCE(n.tolerancia_min, 0) || ' min, último batimento: ' || COALESCE(n.ult::text, 'nunca') || ').',
                'Abrir /dashboard/dev/infra e conferir a peça.', 'novo');
        v_qtd := v_qtd + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN v_qtd;
END $$;
REVOKE ALL ON FUNCTION public.fn_infra_alerta_verificar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_infra_alerta_verificar() TO service_role;

SELECT cron.unschedule('infra-mapa-alerta') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'infra-mapa-alerta');
SELECT cron.schedule('infra-mapa-alerta', '*/10 * * * *', $cron$SELECT public.fn_infra_alerta_verificar()$cron$);

-- Fila de chamados por Code (view v_chamado_code_responsavel): esperando a PS, mais antigo em dias, parado > 48 h.
CREATE OR REPLACE FUNCTION public.fn_infra_chamados_por_code()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão' USING errcode = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'code', code_responsavel, 'carteira', carteira, 'abertos', abertos, 'esperando_ps', esperando,
      'aguardando_cliente', abertos - esperando, 'mais_antigo_dias', antigo_dias, 'parados_48h', parados,
      'alerta', parados > 0) ORDER BY code_responsavel)
    FROM (SELECT code_responsavel, string_agg(DISTINCT socio_carteira, ', ') AS carteira, count(*) AS abertos,
                 count(*) FILTER (WHERE esperando_ps) AS esperando,
                 COALESCE(max(extract(day FROM now() - created_at)) FILTER (WHERE esperando_ps), 0)::int AS antigo_dias,
                 count(*) FILTER (WHERE esperando_ps AND created_at < now() - interval '48 hours') AS parados
          FROM v_chamado_code_responsavel GROUP BY code_responsavel) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fn_infra_chamados_por_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_infra_chamados_por_code() TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'dev.infra.chamados_code','Mapa da Infra','Chamados por Code','Indicador calculado, não editável.',
 'Mostra, por Code, quantos chamados esperam a PS, quantos aguardam o cliente, o mais antigo em dias e alerta quando algum está parado há mais de 48 h. Cada chamado é do Code da carteira dele.',
 'jordana-code: 22 esperando, mais antigo 5 dias.','Achar que outro Code pode resolver: ninguém resolve chamado de outra carteira.',9,'/dashboard/dev/infra','dev','publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
