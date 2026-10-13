-- Saúde da IA · painel de investigação + alerta ATIVO (o poke que faltava).
-- Contexto (handoff #121/#122): o modelo aposentado deixou a IA morta 89 dias em SILÊNCIO.
-- O PR do alarme (erp_ia_falha) cobre "IA que FALHOU" — 404/inválido/rate-limit/timeout, quando
-- alguém CHAMA. Mas o caso dos 89 dias é outro: "IA que PAROU de rodar" — ninguém chamou, então
-- não há falha nenhuma. É o que passou despercebido. Este arquivo cobre o segundo caso e junta os
-- dois num alerta ATIVO via erp_alerta_proativo (mecanismo geral — NÃO um 7º vocabulário de alerta).

-- (1) Liveness das IAs AUTÔNOMAS (as que rodam sozinhas e podem parar em silêncio).
--     On-demand (report, consultor, sugestao-analisar…) não entram aqui: elas legitimamente
--     ficam ociosas e só "falham" quando chamadas — isso o erp_ia_falha já cobre.
CREATE OR REPLACE VIEW public.v_ia_saude
WITH (security_invoker=on) AS
WITH surfaces AS (
  SELECT 'insight-auditor'::text AS surface,
         'Auditor de telas (scores do painel)'::text AS descricao,
         (SELECT max(analisado_em) FROM public.system_screens_insights) AS ultimo_sucesso,
         30::int AS limite_horas,
         '/dashboard/admin'::text AS link
  UNION ALL
  SELECT 'gold-camada2',
         'Auditoria Gold — análise de jornada por IA',
         (SELECT max(executado_em) FROM public.gold_camada2_validacoes WHERE claude_custo_usd > 0),
         30,
         '/dashboard/noc'
)
SELECT s.surface, s.descricao, s.ultimo_sucesso, s.limite_horas, s.link,
       round(extract(epoch FROM (now() - s.ultimo_sucesso))/3600, 1) AS horas_desde_sucesso,
       (s.ultimo_sucesso IS NULL
         OR now() - s.ultimo_sucesso > make_interval(hours => s.limite_horas)) AS parada
FROM surfaces s;
GRANT SELECT ON public.v_ia_saude TO authenticated, service_role;

-- (2) Scan: transforma o estado em ALERTA ATIVO (grava e cutuca), com dedup e auto-resolução.
--     Dois tipos distintos, como o CEO pediu:
--       'ia_parada:<surface>'  → IA que PAROU de rodar (heartbeat vencido; sem falha registrada)
--       'ia_falhou'            → IA que FALHOU (uma ou mais linhas abertas em erp_ia_falha)
--     Segue o padrão do fn_atak_alerta_silencio (dedup por EXISTS de alerta aberto do mesmo tipo).
CREATE OR REPLACE FUNCTION public.fn_ia_saude_scan()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_tipo text;
  v_aberto boolean;
  v_criados int := 0;
  v_resolvidos int := 0;
  v_falhas_abertas int;
  v_endpoints int;
  v_company uuid;
BEGIN
  -- erp_alerta_proativo.company_id é NOT NULL. Alerta de saúde da IA é de SISTEMA:
  -- ancoramos na empresa operadora (PS Gestão & Capital), onde a equipe PS enxerga.
  SELECT id INTO v_company FROM public.companies
   WHERE nome_fantasia = 'PS GESTAO & CAPITAL' OR razao_social ILIKE 'PS CONSULTORIA%'
   ORDER BY created_at LIMIT 1;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_operadora_nao_encontrada');
  END IF;

  -- (a) IA parada (heartbeat) — um alerta por surface
  FOR r IN SELECT * FROM public.v_ia_saude LOOP
    v_tipo := 'ia_parada:' || r.surface;
    SELECT EXISTS (
      SELECT 1 FROM public.erp_alerta_proativo
       WHERE tipo = v_tipo AND coalesce(resolvido,false)=false AND coalesce(dispensado,false)=false
    ) INTO v_aberto;

    IF r.parada AND NOT v_aberto THEN
      INSERT INTO public.erp_alerta_proativo (company_id, tipo, titulo, mensagem, severidade, link_acao, contexto)
      VALUES (v_company, v_tipo,
        'IA parada: ' || r.descricao,
        CASE WHEN r.ultimo_sucesso IS NULL
             THEN 'A IA "' || r.surface || '" nunca registrou sucesso. Verificar o disparo (cron/gatilho).'
             ELSE 'A IA "' || r.surface || '" não roda com sucesso desde ' ||
                  to_char(r.ultimo_sucesso AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ||
                  ' (' || r.horas_desde_sucesso || 'h). Ninguém chamou / o gatilho parou — não gera falha, some em silêncio.'
        END,
        'alta', r.link,
        jsonb_build_object('base','heartbeat_ia','surface',r.surface,
          'ultimo_sucesso',r.ultimo_sucesso,'horas_desde',r.horas_desde_sucesso,'limite_horas',r.limite_horas));
      v_criados := v_criados + 1;

    ELSIF (NOT r.parada) AND v_aberto THEN
      -- voltou a rodar: resolve sozinho
      UPDATE public.erp_alerta_proativo
         SET resolvido=true, resolvido_em=now()
       WHERE tipo=v_tipo AND coalesce(resolvido,false)=false AND coalesce(dispensado,false)=false;
      v_resolvidos := v_resolvidos + 1;
    END IF;
  END LOOP;

  -- (b) IA que falhou (erp_ia_falha aberto) — um alerta agregado
  SELECT count(*), count(DISTINCT endpoint) INTO v_falhas_abertas, v_endpoints
    FROM public.erp_ia_falha WHERE resolvido = false;

  SELECT EXISTS (
    SELECT 1 FROM public.erp_alerta_proativo
     WHERE tipo='ia_falhou' AND coalesce(resolvido,false)=false AND coalesce(dispensado,false)=false
  ) INTO v_aberto;

  IF v_falhas_abertas > 0 AND NOT v_aberto THEN
    INSERT INTO public.erp_alerta_proativo (company_id, tipo, titulo, mensagem, severidade, link_acao, contexto)
    VALUES (v_company, 'ia_falhou',
      'IA falhou em ' || v_endpoints || ' endpoint(s)',
      v_falhas_abertas || ' falha(s) de chamada Claude em aberto (404/modelo inválido/rate-limit/timeout). ' ||
      'Investigar em v_ia_saude_endpoints.',
      'alta', '/dashboard/noc',
      jsonb_build_object('base','erp_ia_falha','falhas_abertas',v_falhas_abertas,'endpoints',v_endpoints));
    v_criados := v_criados + 1;

  ELSIF v_falhas_abertas = 0 AND v_aberto THEN
    UPDATE public.erp_alerta_proativo SET resolvido=true, resolvido_em=now()
     WHERE tipo='ia_falhou' AND coalesce(resolvido,false)=false AND coalesce(dispensado,false)=false;
    v_resolvidos := v_resolvidos + 1;
  END IF;

  RETURN jsonb_build_object('ok',true,'alertas_criados',v_criados,'alertas_resolvidos',v_resolvidos,
    'falhas_abertas',v_falhas_abertas);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ia_saude_scan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ia_saude_scan() TO service_role;

-- (3) Cron: varre de hora em hora (idempotente — recria o agendamento se já existir).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='ia-saude-scan-hourly') THEN
      PERFORM cron.unschedule('ia-saude-scan-hourly');
    END IF;
    PERFORM cron.schedule('ia-saude-scan-hourly','7 * * * *', $$SELECT public.fn_ia_saude_scan();$$);
  END IF;
END $cron$;
