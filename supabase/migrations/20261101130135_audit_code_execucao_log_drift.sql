-- Drift da camada de auditoria dos Codes: objetos criados em produção via MCP, agora versionados (idempotente).
-- Code: code-desenvolvedor-3
-- ci-sem-guarda: fn_code_log_execucao — infra interna de log de execução dos Codes; sem company_id; REVOKE anon/authenticated, EXECUTE só service_role
-- ci-sem-guarda: fn_vigia_desencalhar_em_andamento — infra interna de orquestração (desencalhe de mensagem de dev); sem company_id; EXECUTE só service_role

CREATE TABLE IF NOT EXISTS public.erp_code_execucao_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente        text NOT NULL,
  iniciada_em   timestamptz,
  encerrada_em  timestamptz DEFAULT now(),
  resultado     text,
  prs_abertas   integer DEFAULT 0,
  prs_ready     integer DEFAULT 0,
  prs_fechadas  integer DEFAULT 0,
  motivo_parada text,
  erro          text,
  o_que_fez     text,
  criado_em     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_code_log_agente_data ON public.erp_code_execucao_log (agente, criado_em DESC);
ALTER TABLE public.erp_code_execucao_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_code_log_execucao(p_agente text, p_resultado text, p_motivo text DEFAULT NULL::text, p_prs_abertas integer DEFAULT 0, p_prs_ready integer DEFAULT 0, p_prs_fechadas integer DEFAULT 0, p_erro text DEFAULT NULL::text, p_o_que_fez text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO erp_code_execucao_log(agente,resultado,motivo_parada,prs_abertas,prs_ready,prs_fechadas,erro,o_que_fez,
    iniciada_em)
  VALUES (p_agente,p_resultado,p_motivo,p_prs_abertas,p_prs_ready,p_prs_fechadas,p_erro,p_o_que_fez,
    (SELECT max(iniciada_em) FROM erp_agente_sessao_lease WHERE agente=p_agente))
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE VIEW public.v_code_ultima_execucao WITH (security_invoker = true) AS
 SELECT DISTINCT ON (agente) agente,
    to_char((encerrada_em AT TIME ZONE 'America/Sao_Paulo'::text), 'DD/MM HH24:MI'::text) AS quando,
    resultado,
    prs_abertas,
    prs_ready,
    prs_fechadas,
    "left"(motivo_parada, 100) AS motivo,
    "left"(erro, 100) AS erro,
    "left"(o_que_fez, 120) AS o_que_fez
   FROM erp_code_execucao_log
  ORDER BY agente, encerrada_em DESC;

CREATE OR REPLACE FUNCTION public.fn_vigia_desencalhar_em_andamento(p_horas integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int; v_lista jsonb;
BEGIN
  WITH presas AS (
    SELECT m.id, m.para, left(m.assunto,60) AS assunto
    FROM erp_agente_mensagem m
    JOIN erp_agente_papel p ON p.agente = m.para AND p.papel = 'dev_hub'   -- SÓ devs
    WHERE m.status='em_andamento'
      AND m.assunto NOT ILIKE '%PLANT%O PERMANENTE%'                        -- nunca plantão
      AND coalesce(m.atualizado_em, m.iniciada_em, m.criado_em) < now() - (p_horas || ' hours')::interval
  ),
  upd AS (
    UPDATE erp_agente_mensagem m
    SET status='recusada',
        resposta = left(coalesce(m.resposta,'') || ' [vigia-desencalhe: dev preso >'||p_horas||'h sem toque; recusada auto '||to_char(now(),'DD/MM HH24:MI')||']',4000)
    FROM presas WHERE m.id = presas.id
    RETURNING presas.para, presas.assunto
  )
  SELECT count(*), coalesce(jsonb_agg(jsonb_build_object('dev',para,'tarefa',assunto)),'[]'::jsonb)
  INTO v_n, v_lista FROM upd;
  RETURN jsonb_build_object('ok',true,'desencalhadas',v_n,'limiar_horas',p_horas,'escopo','apenas_devs','em',now(),'detalhe',v_lista);
END $function$;

REVOKE ALL ON TABLE public.erp_code_execucao_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.v_code_ultima_execucao FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_code_log_execucao(text,text,text,integer,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_vigia_desencalhar_em_andamento(integer) FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.erp_code_execucao_log TO service_role;
GRANT SELECT ON TABLE public.v_code_ultima_execucao TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_code_log_execucao(text,text,text,integer,integer,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_vigia_desencalhar_em_andamento(integer) TO service_role;
