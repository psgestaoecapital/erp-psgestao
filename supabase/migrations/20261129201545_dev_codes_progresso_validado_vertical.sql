-- Aba Codes · gráfico de LINHAS "Pronto e validado por vertical ao longo dos dias" + tabela "Qual priorizar"
-- (CEO 22/11 11:12, caixa e7cf025c · decisões do Eng. Chefe). Faixa :45 (desenvolvedor_4_g).
--
-- "Validado" ≠ "construído": a barra da #5823 (BarrasQualidadeVertical) mostra o CONSTRUÍDO (o dev marca ao
-- publicar); esta LINHA mostra só o que um AUDITOR confirmou (status_baseline='atendido' com evidência de auditor).
-- Medida padrão = ESSENCIAIS (essenciais validados ÷ essenciais da vertical); os diferenciais inflam o denominador
-- e escondem o que falta para vender.
--
-- ADITIVA (RD-97): 2 colunas NOVAS em blueprint_tela_requisito (dado interno da PS, NUNCA dado de cliente) + trigger
-- que as mantém + tabela NOVA de histórico diário + 2 funções NOVAS + 1 PERFORM no fim de fn_code_log_execucao
-- (CREATE OR REPLACE a partir da definição VIVA; o snapshot é embrulhado em EXCEPTION para NUNCA quebrar o log).
-- SEM CRON NOVO (RD-42): toda rodada de Code atualiza o dia via fn_code_log_execucao; a RPC da tela também chama.
-- Plano de volta: DROP do trigger/função de trigger, das 2 funções e da tabela; as colunas podem ficar (aditivas);
-- devolver fn_code_log_execucao à versão sem o PERFORM.

-- ───────────────────────── 1) coluna de validação no blueprint (interno PS) ─────────────────────────
ALTER TABLE public.blueprint_tela_requisito
  ADD COLUMN IF NOT EXISTS validado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS validado_por text;
COMMENT ON COLUMN public.blueprint_tela_requisito.validado_em IS
  'Quando um AUDITOR confirmou o requisito (status_baseline=atendido com evidência de auditor). NULL = não validado. Mantida pelo trigger trg_blueprint_validado.';

-- Trigger: valida só quando atendido E a evidência é de auditor (pdca/aud8/auditor…). Se deixar de ser, volta a NULL.
-- Não toca dado de cliente — blueprint_tela_requisito é catálogo interno da PS.
CREATE OR REPLACE FUNCTION public.fn_blueprint_validado_sync() RETURNS trigger
 LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.status_baseline = 'atendido' AND COALESCE(NEW.evidencia_baseline, '') ~* '^(pdca|aud8|auditor)' THEN
    IF NEW.validado_em IS NULL THEN NEW.validado_em := now(); END IF;  -- não re-carimba se já validado
    NEW.validado_por := COALESCE(NEW.validado_por,
      substring(lower(NEW.evidencia_baseline) from '^(pdca|aud8|auditor[a-z0-9_]*)'), 'auditor');
  ELSE
    NEW.validado_em  := NULL;
    NEW.validado_por := NULL;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_blueprint_validado ON public.blueprint_tela_requisito;
CREATE TRIGGER trg_blueprint_validado
  BEFORE INSERT OR UPDATE OF status_baseline, evidencia_baseline, validado_em, validado_por
  ON public.blueprint_tela_requisito
  FOR EACH ROW EXECUTE FUNCTION public.fn_blueprint_validado_sync();

-- Backfill (RD-38): só as linhas que JÁ são atendido com evidência de auditor. O trigger deixa passar os valores.
UPDATE public.blueprint_tela_requisito
   SET validado_em = now(), validado_por = 'backfill 22/11'
 WHERE status_baseline = 'atendido'
   AND COALESCE(evidencia_baseline, '') ~* '^(pdca|aud8|auditor)'
   AND validado_em IS NULL;

-- ───────────────────────── 2) histórico diário do validado por vertical ─────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_vertical_progresso_dia (
  dia               date    NOT NULL,
  vertical          text    NOT NULL,
  req_total         integer NOT NULL DEFAULT 0,
  req_validados     integer NOT NULL DEFAULT 0,
  ess_total         integer NOT NULL DEFAULT 0,
  ess_validados     integer NOT NULL DEFAULT 0,
  req_atendidos     integer NOT NULL DEFAULT 0,
  ess_atendidos     integer NOT NULL DEFAULT 0,
  pct_ess_validado  numeric NOT NULL DEFAULT 0,
  pct_validado      numeric NOT NULL DEFAULT 0,
  capturado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dia, vertical)
);
COMMENT ON TABLE public.erp_vertical_progresso_dia IS
  'Retrato diário do % VALIDADO pelo auditor por vertical (aba Codes). Gravado por fn_vertical_progresso_snapshot; leitura só equipe PS.';
ALTER TABLE public.erp_vertical_progresso_dia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_vertical_progresso_dia FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_vertical_progresso_dia TO authenticated;
GRANT ALL ON TABLE public.erp_vertical_progresso_dia TO service_role;
DROP POLICY IF EXISTS erp_vertical_progresso_dia_sel_equipe_ps ON public.erp_vertical_progresso_dia;
CREATE POLICY erp_vertical_progresso_dia_sel_equipe_ps ON public.erp_vertical_progresso_dia
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

-- Retrato do dia (idempotente: 1 linha por dia e vertical; UMA agregação do blueprint, nunca função por linha).
CREATE OR REPLACE FUNCTION public.fn_vertical_progresso_snapshot() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE n integer := 0;
BEGIN
  INSERT INTO erp_vertical_progresso_dia
    (dia, vertical, req_total, req_validados, ess_total, ess_validados, req_atendidos, ess_atendidos,
     pct_ess_validado, pct_validado, capturado_em)
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
         vertical,
         count(*),
         count(*) FILTER (WHERE validado_em IS NOT NULL),
         count(*) FILTER (WHERE prioridade = 'essencial'),
         count(*) FILTER (WHERE prioridade = 'essencial' AND validado_em IS NOT NULL),
         count(*) FILTER (WHERE status_baseline = 'atendido'),
         count(*) FILTER (WHERE prioridade = 'essencial' AND status_baseline = 'atendido'),
         COALESCE(round(100.0 * count(*) FILTER (WHERE prioridade = 'essencial' AND validado_em IS NOT NULL)
               / NULLIF(count(*) FILTER (WHERE prioridade = 'essencial'), 0), 1), 0),  -- vertical sem essenciais → 0, não NULL (coluna NOT NULL)
         COALESCE(round(100.0 * count(*) FILTER (WHERE validado_em IS NOT NULL) / NULLIF(count(*), 0), 1), 0),
         now()
    FROM blueprint_tela_requisito
   GROUP BY vertical
  ON CONFLICT (dia, vertical) DO UPDATE SET
     req_total = EXCLUDED.req_total, req_validados = EXCLUDED.req_validados,
     ess_total = EXCLUDED.ess_total, ess_validados = EXCLUDED.ess_validados,
     req_atendidos = EXCLUDED.req_atendidos, ess_atendidos = EXCLUDED.ess_atendidos,
     pct_ess_validado = EXCLUDED.pct_ess_validado, pct_validado = EXCLUDED.pct_validado,
     capturado_em = EXCLUDED.capturado_em;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM erp_vertical_progresso_dia WHERE dia < (now() AT TIME ZONE 'America/Sao_Paulo')::date - 400;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.fn_vertical_progresso_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_vertical_progresso_snapshot() TO service_role;

-- Leitura da tela: série diária por vertical. Só equipe PS. Chama o snapshot (garantia) sem jamais falhar a leitura.
CREATE OR REPLACE FUNCTION public.fn_vertical_progresso_serie(p_dias integer DEFAULT 90) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_out jsonb; v_dias integer := LEAST(GREATEST(COALESCE(p_dias, 90), 1), 400);
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  BEGIN PERFORM public.fn_vertical_progresso_snapshot();
  EXCEPTION WHEN OTHERS THEN NULL; END;  -- a leitura nunca cai por causa do snapshot
  SELECT jsonb_build_object(
    'ok', true, 'gerado_em', now(), 'dias', v_dias,
    'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'dia', dia, 'vertical', vertical,
        'pct_ess_validado', pct_ess_validado, 'pct_validado', pct_validado,
        'ess_validados', ess_validados, 'ess_total', ess_total,
        'req_validados', req_validados, 'req_total', req_total) ORDER BY dia, vertical)
      FROM erp_vertical_progresso_dia
      WHERE dia >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - v_dias), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.fn_vertical_progresso_serie(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_vertical_progresso_serie(integer) TO authenticated, service_role;

-- ───────────────────────── 3) gatilho sem cron: toda rodada de Code atualiza o dia ─────────────────────────
-- CREATE OR REPLACE a partir da definição VIVA (RD-94.1), só acrescentando o PERFORM do snapshot no fim, dentro de
-- um bloco EXCEPTION que NUNCA deixa o log de execução falhar.
CREATE OR REPLACE FUNCTION public.fn_code_log_execucao(p_agente text, p_resultado text, p_motivo text DEFAULT NULL::text, p_prs_abertas integer DEFAULT 0, p_prs_ready integer DEFAULT 0, p_prs_fechadas integer DEFAULT 0, p_erro text DEFAULT NULL::text, p_o_que_fez text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ci-sem-guarda: fn_code_log_execucao — log de execução por agente (telemetria dev, conexão de serviço); não há company_id no registro a conferir
DECLARE v_id uuid;
BEGIN
  INSERT INTO erp_code_execucao_log(agente,resultado,motivo_parada,prs_abertas,prs_ready,prs_fechadas,erro,o_que_fez,
    iniciada_em)
  VALUES (p_agente,p_resultado,p_motivo,p_prs_abertas,p_prs_ready,p_prs_fechadas,p_erro,p_o_que_fez,
    (SELECT max(iniciada_em) FROM erp_agente_sessao_lease WHERE agente=p_agente))
  RETURNING id INTO v_id;
  -- Atualiza o retrato do dia do "validado por vertical" a cada rodada de Code (RD-42: sem cron novo).
  BEGIN PERFORM public.fn_vertical_progresso_snapshot();
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN v_id;
END $function$;

-- ACL explícita espelhando a viva (RD-94.1 · check_fn_guards[revoke_anon]): recriação de SECURITY DEFINER
-- carimba a ACL; mantém EXATAMENTE o que já vale (proacl vivo = service_role=X), sem ampliar (nunca anon/PUBLIC,
-- nunca authenticated — é telemetria chamada só pela conexão de serviço no fim da rodada do Code).
REVOKE ALL ON FUNCTION public.fn_code_log_execucao(text,text,text,integer,integer,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_code_log_execucao(text,text,text,integer,integer,integer,text,text) TO service_role;

-- Ponto inicial: grava o retrato de HOJE já nesta migration (RD-38: não inventa dias passados).
SELECT public.fn_vertical_progresso_snapshot();

-- ───────────────────────── 4) ajuda "?" (RD-95) ─────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
 ('dev.codes.progresso_validado', 'Pronto e validado por vertical', 'Pronto e validado por vertical',
  'Indicador de leitura — não se preenche.',
  'Mostra, dia a dia, uma linha por vertical com o % de requisitos ESSENCIAIS que um AUDITOR já validou (não o que o dev disse estar pronto). Validado = o auditor confirmou a tela na jornada real; construído (gráfico de colunas acima) = o dev marcou ao publicar. A diferença entre os dois é o que ainda falta PROVAR. Serve para decidir qual vertical priorizar.',
  'Exemplo ilustrativo: a Gestão em 10% validado e o Hub em 1% querem dizer que, dos requisitos essenciais, só essa fração passou pelo auditor — o resto ainda não foi provado, mesmo que já construído.',
  'Ler validado como construído: validado é sempre menor, porque conta só o que o auditor confirmou. Linha parada = nenhuma validação nova naquela vertical.',
  70, '/dashboard/dev/codes', 'dev', 'publicado'),
 ('dev.codes.progresso_validado.medida', 'Pronto e validado por vertical', 'Essenciais × Todos os requisitos',
  'Escolha a medida: Essenciais (padrão) ou Todos os requisitos.',
  'Essenciais = o mínimo para vender e operar a vertical; é a medida que importa. "Todos" inclui os diferenciais, que incham o denominador e escondem o que falta para vender.',
  'Exemplo: 53 de 528 essenciais validados = 10%. Em "Todos", o mesmo denominador cresce e o % cai.',
  'Comparar verticais em "Todos": uma pode parecer atrás só por ter mais diferenciais mapeados.',
  71, '/dashboard/dev/codes', 'dev', 'publicado'),
 ('dev.codes.progresso_validado.priorizar', 'Pronto e validado por vertical', 'Qual priorizar',
  'Indicador de leitura — não se preenche.',
  'Por vertical: % validado hoje, o ritmo dos últimos 7 dias (pontos percentuais por semana), a previsão de chegar a 100% no ritmo atual e quantos essenciais ainda faltam. A vertical destacada em dourado é a que mais precisa de reforço: muitos essenciais faltando e pouco (ou nenhum) ritmo.',
  'Exemplo: uma vertical com 300 essenciais faltando e ritmo 0 aparece em dourado — é onde colocar gente.',
  'Confiar na previsão com pouco histórico: com menos de 7 dias aparece "medindo — n dias" e a previsão fica instável.',
  72, '/dashboard/dev/codes', 'dev', 'publicado')
ON CONFLICT (chave) DO NOTHING;
