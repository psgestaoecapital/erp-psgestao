-- Saúde dos Codes (Eng. Chefe 17/10, msg 502b285e): o painel mostrava TRAVADO para Code que estava trabalhando.
-- Causa: fn_agente_sessao_encerrar libera a vez gravando renovada_em = now() - 1 dia (proposital) e a saúde lia isso
-- como "última atividade". Regra nova (mesmas chaves de antes + campos novos, o front antigo segue lendo):
--   última sessão = iniciada_em · trabalhando = renovada_em > now() - 12 min · encerrou normalmente = renovada_em < iniciada_em
--   TRAVADO só com trabalho pendente (tarefa aberta OU PR do Code parada) E plantão sem atualização há mais de 30 min.
CREATE OR REPLACE FUNCTION public.fn_codes_saude()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT jsonb_agg(x ORDER BY x->>'code') FROM (
  SELECT jsonb_build_object(
    'code', r.agente,
    'lease_ativa', coalesce(l.trabalhando, false),
    'tarefas_recentes', coalesce(p.n_rec,0),
    'mais_antiga_recente_min', coalesce(p.idade_rec,0)::int,
    'backlog_antigo', coalesce(p.n_tot,0) - coalesce(p.n_rec,0),
    'ultima_sessao_em', l.iniciada_em,
    'encerrou_normalmente', coalesce(l.encerrou, false),
    'trabalho_pendente', (coalesce(p.n_tot,0) > 0 OR coalesce(pr.n,0) > 0),
    'prs_paradas', coalesce(pr.n,0),
    'plantao_min', CASE WHEN a.ultima IS NULL THEN NULL ELSE round(EXTRACT(EPOCH FROM (now()-a.ultima))/60)::int END,
    'status', CASE
       WHEN coalesce(l.trabalhando,false) THEN 'trabalhando'
       WHEN coalesce(p.n_tot,0) = 0 AND coalesce(pr.n,0) = 0 THEN 'ocioso'
       WHEN a.ultima IS NULL OR a.ultima < now() - interval '30 minutes' THEN 'TRAVADO'
       ELSE 'na fila' END
  ) AS x
  FROM erp_agente_rotina r
  LEFT JOIN LATERAL (
    SELECT max(iniciada_em) AS iniciada_em,
           bool_or(renovada_em > now() - interval '12 minutes') AS trabalhando,
           (array_agg(renovada_em < iniciada_em ORDER BY iniciada_em DESC))[1] AS encerrou
    FROM erp_agente_sessao_lease WHERE agente = r.agente
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n_tot,
           count(*) FILTER (WHERE atualizado_em > now()-interval '4 hours') AS n_rec,
           round(EXTRACT(EPOCH FROM (now()-min(atualizado_em) FILTER (WHERE atualizado_em > now()-interval '4 hours')))/60) AS idade_rec
    FROM erp_agente_mensagem
    WHERE para=r.agente AND tipo='tarefa' AND NOT arquivada AND status IN ('recebida','em_andamento')
  ) p ON true
  LEFT JOIN LATERAL (
    -- plantão = última atualização de mensagem em que o Code participa (anotação dele ou tarefa dele)
    SELECT max(atualizado_em) AS ultima FROM erp_agente_mensagem
    WHERE (de=r.agente OR para=r.agente) AND atualizado_em > now() - interval '7 days'
  ) a ON true
  LEFT JOIN LATERAL (
    -- PR do Code parada = último evento da PR (7 dias) é aberta/pronta há mais de 30 min
    SELECT count(*) AS n FROM (
      SELECT DISTINCT ON (pr_numero) evento, ocorrido_em FROM erp_dev_entrega
      WHERE code = r.agente AND ocorrido_em > now() - interval '7 days'
      ORDER BY pr_numero, ocorrido_em DESC
    ) u WHERE u.evento IN ('aberta','pronta') AND u.ocorrido_em < now() - interval '30 minutes'
  ) pr ON true
  WHERE r.aciona = true
) s;
$function$;

REVOKE ALL ON FUNCTION public.fn_codes_saude() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_codes_saude() TO authenticated, service_role;
