-- Aba Codes · "Mapa da Infra" (CEO 14/10, msg 2da79cd2) — fatia 1: desenho esperado + batimento + estado + alerta. Faixa 05.
-- Aditiva: tabelas NOVAS (RLS ligada, leitura só equipe PS por fn_dev_painel_pode_ver, REVOKE anon) + funções novas.
--  1) erp_infra_desenho_versao / erp_infra_no / erp_infra_ligacao — o desenho ESPERADO, versionado (nó: dono, cadência, tolerância).
--  2) erp_infra_batimento — uma linha por rodada (revisor e Codes gravam por fn_infra_batimento_registrar; crons são lidos de cron.job_run_details).
--  3) fn_infra_estado() — por nó: último batimento, atraso, cor (verde na cadência · amarelo atrasado · vermelho parado).
--  4) fn_infra_config_salvar() — edita cadência/tolerância (só PS_ADMIN, com auditoria em audit_log_global).
--  5) fn_infra_alertar() — nó vermelho avisa o CEO por erp_truth_alerts (canal do briefing); pg_cron a cada 10 min.
--  6) Realtime + system_screens (RD-50) + "?" (RD-95).

CREATE TABLE IF NOT EXISTS public.erp_infra_desenho_versao (
  versao     integer PRIMARY KEY CHECK (versao > 0),
  descricao  text NOT NULL DEFAULT '',
  vigente    boolean NOT NULL DEFAULT false,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_infra_desenho_vigente_uq ON public.erp_infra_desenho_versao (vigente) WHERE vigente;

CREATE TABLE IF NOT EXISTS public.erp_infra_no (
  versao        integer NOT NULL REFERENCES public.erp_infra_desenho_versao(versao),
  chave         text NOT NULL,
  nome          text NOT NULL,
  camada        text NOT NULL CHECK (camada IN ('sistemas','esteira','bancos_teste','producao','auditores','agentes')),
  tipo          text NOT NULL CHECK (tipo IN ('cron','workflow','agente','banco','servico')),
  dono          text NOT NULL,
  cadencia_min  integer CHECK (cadencia_min > 0),     -- NULL = sem cadência (por evento)
  tolerancia_min integer NOT NULL DEFAULT 10 CHECK (tolerancia_min >= 0),
  cron_jobname  text,                                  -- nó lido direto de cron.job_run_details
  ordem         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (versao, chave)
);

CREATE TABLE IF NOT EXISTS public.erp_infra_ligacao (
  versao   integer NOT NULL,
  de_no    text NOT NULL,
  para_no  text NOT NULL,
  rotulo   text NOT NULL DEFAULT '',
  PRIMARY KEY (versao, de_no, para_no),
  FOREIGN KEY (versao, de_no)   REFERENCES public.erp_infra_no(versao, chave),
  FOREIGN KEY (versao, para_no) REFERENCES public.erp_infra_no(versao, chave)
);

CREATE TABLE IF NOT EXISTS public.erp_infra_batimento (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  no              text NOT NULL,
  inicio          timestamptz NOT NULL,
  fim             timestamptz NOT NULL,
  itens_olhados   integer NOT NULL DEFAULT 0 CHECK (itens_olhados >= 0),
  itens_decididos integer NOT NULL DEFAULT 0 CHECK (itens_decididos >= 0),
  resultado       text NOT NULL CHECK (resultado IN ('ok','parcial','falha')),
  detalhe         text NOT NULL DEFAULT '',
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_infra_batimento_no_idx ON public.erp_infra_batimento (no, fim DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_infra_desenho_versao','erp_infra_no','erp_infra_ligacao','erp_infra_batimento'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel_equipe_ps', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver())', t || '_sel_equipe_ps', t);
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── desenho esperado v1 (cadências conforme os crons/workflows documentados; editáveis na tela) ───────────────────
INSERT INTO public.erp_infra_desenho_versao (versao, descricao, vigente)
VALUES (1, 'Desenho inicial (CEO 14/10): esteira, auditores, agentes e bancos de teste.', true)
ON CONFLICT (versao) DO NOTHING;

INSERT INTO public.erp_infra_no (versao, chave, nome, camada, tipo, dono, cadencia_min, tolerancia_min, cron_jobname, ordem)
SELECT 1, v.chave, v.nome, v.camada, v.tipo, v.dono, v.cad, v.tol, v.cron, v.ordem
FROM (VALUES
 ('sistemas',        'Sistemas e usuários',          'sistemas',     'servico',  'eng_chefe',        NULL::int, 0,  NULL::text, 10),
 ('agente_desenv',   'Code gilberto-desenv',         'agentes',      'agente',   'gilberto-desenv',  NULL, 0,  NULL, 20),
 ('agente_produto',  'Code gilberto-produto',        'agentes',      'agente',   'gilberto-produto', NULL, 0,  NULL, 21),
 ('agente_chamados', 'Code gilberto-chamados',       'agentes',      'agente',   'gilberto-chamados',NULL, 0,  NULL, 22),
 ('agente_rodrigo',  'Code rodrigo-code',            'agentes',      'agente',   'rodrigo-code',     NULL, 0,  NULL, 23),
 ('agente_jordana',  'Code jordana-code',            'agentes',      'agente',   'jordana-code',     NULL, 0,  NULL, 24),
 ('despertador',     'Despertador dos Codes',        'agentes',      'cron',     'eng_chefe',        30,   10, 'agente_despertador', 30),
 ('vigia',           'Vigia de runs e agentes',      'esteira',      'cron',     'eng_chefe',        10,   10, 'vigia-coleta-agentes', 40),
 ('monitor_merge',   'Monitor da fila de merge',     'esteira',      'cron',     'eng_chefe',        5,    10, 'monitor-merge-tick', 41),
 ('fila_merge',      'Fila de merge',                'esteira',      'workflow', 'eng_chefe',        NULL, 0,  NULL, 42),
 ('revisor',         'Revisor (gilberto-revisor)',   'esteira',      'agente',   'gilberto-revisor', 5,    15, NULL, 43),
 ('aceitacao_pr',    'Aceitação da PR',              'esteira',      'workflow', 'eng_chefe',        NULL, 0,  NULL, 44),
 ('aceitacao_main',  'Aceitação da main',            'esteira',      'workflow', 'eng_chefe',        60,   30, NULL, 45),
 ('vaga_0',          'Banco de testes — vaga 0',     'bancos_teste', 'banco',    'eng_chefe',        NULL, 0,  NULL, 50),
 ('vaga_1',          'Banco de testes — vaga 1',     'bancos_teste', 'banco',    'eng_chefe',        NULL, 0,  NULL, 51),
 ('deploy_migrations','deploy-migrations',           'producao',     'workflow', 'eng_chefe',        NULL, 0,  NULL, 60),
 ('pos_migration',   '@pos-migration (produção)',    'producao',     'workflow', 'eng_chefe',        NULL, 0,  NULL, 61),
 ('producao',        'Banco de produção',            'producao',     'banco',    'eng_chefe',        NULL, 0,  NULL, 62),
 ('auditor_main',    'Alerta main vermelha',         'auditores',    'cron',     'eng_chefe',        10,   10, 'dev-main-vermelha-alerta', 70),
 ('auditor_matriz',  'Auditor de matriz',            'auditores',    'cron',     'eng_chefe',        5,    10, 'auditor-matriz-consultar-5min', 71),
 ('auditor_dre',     'Auditor de verdade (DRE)',     'auditores',    'cron',     'eng_chefe',        60,   20, 'truth-auditor-dre-1h', 72),
 ('auditor_drift',   'Detector de drift (RD-35)',    'auditores',    'cron',     'eng_chefe',        15,   10, 'rd35-detectar-drift-15min', 73),
 ('snapshot_codes',  'Retrato da aba Codes',         'auditores',    'cron',     'gilberto-produto', 15,   10, 'dev-codes-snapshot-15min', 74)
) AS v(chave, nome, camada, tipo, dono, cad, tol, cron, ordem)
ON CONFLICT (versao, chave) DO NOTHING;

INSERT INTO public.erp_infra_ligacao (versao, de_no, para_no, rotulo)
SELECT 1, v.a, v.b, v.r FROM (VALUES
 ('sistemas','agente_desenv','tarefas'), ('sistemas','agente_produto','tarefas'), ('sistemas','agente_chamados','chamados'),
 ('despertador','agente_desenv','acorda'), ('despertador','agente_produto','acorda'), ('despertador','agente_chamados','acorda'),
 ('agente_desenv','fila_merge','PR Ready'), ('agente_produto','fila_merge','PR Ready'), ('agente_chamados','fila_merge','PR Ready'),
 ('agente_rodrigo','fila_merge','PR Ready'), ('agente_jordana','fila_merge','PR Ready'),
 ('fila_merge','revisor','PR com etiqueta'), ('revisor','fila_merge','MERGE AUTORIZADO'),
 ('fila_merge','aceitacao_pr','checks'), ('aceitacao_pr','vaga_0','usa banco'), ('aceitacao_pr','vaga_1','usa banco'),
 ('aceitacao_main','vaga_0','usa banco'), ('aceitacao_main','vaga_1','usa banco'),
 ('fila_merge','deploy_migrations','merge na main'), ('deploy_migrations','producao','aplica migration'),
 ('deploy_migrations','pos_migration','dispara'), ('pos_migration','producao','prova'),
 ('monitor_merge','fila_merge','vigia'), ('vigia','aceitacao_pr','cancela/re-roda'),
 ('auditor_main','pos_migration','lê veredito'), ('auditor_matriz','producao','lê'), ('auditor_dre','producao','lê'),
 ('auditor_drift','producao','lê'), ('snapshot_codes','fila_merge','lê')
) AS v(a,b,r)
WHERE EXISTS (SELECT 1 FROM public.erp_infra_no WHERE versao=1 AND chave=v.a)
  AND EXISTS (SELECT 1 FROM public.erp_infra_no WHERE versao=1 AND chave=v.b)
ON CONFLICT DO NOTHING;

-- ── batimento: revisor e Codes gravam ao fim de cada rodada (só service_role) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_infra_batimento_registrar(
  p_no text, p_inicio timestamptz, p_fim timestamptz, p_itens_olhados integer DEFAULT 0,
  p_itens_decididos integer DEFAULT 0, p_resultado text DEFAULT 'ok', p_detalhe text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
-- ci-sem-guarda: canal de serviço (REVOKE de anon/authenticated); quem chama é o revisor/Code, não usuário
BEGIN
  IF NOT EXISTS (SELECT 1 FROM erp_infra_no WHERE chave = p_no) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nó desconhecido: ' || coalesce(p_no,'null'));
  END IF;
  INSERT INTO erp_infra_batimento (no, inicio, fim, itens_olhados, itens_decididos, resultado, detalhe)
  VALUES (p_no, p_inicio, p_fim, greatest(coalesce(p_itens_olhados,0),0), greatest(coalesce(p_itens_decididos,0),0),
          p_resultado, left(coalesce(p_detalhe,''), 500));
  RETURN jsonb_build_object('ok', true, 'no', p_no);
END $function$;
REVOKE ALL ON FUNCTION public.fn_infra_batimento_registrar(text,timestamptz,timestamptz,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_infra_batimento_registrar(text,timestamptz,timestamptz,integer,integer,text,text) TO service_role;

-- ── estado por nó (batimento próprio OU cron.job_run_details; o mais recente) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_infra_estado_interno() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
-- ci-sem-guarda: cálculo interno (cron e fn_infra_estado); só service_role
DECLARE r jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'ordem')::int), '[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object(
      'chave', n.chave, 'nome', n.nome, 'camada', n.camada, 'tipo', n.tipo, 'dono', n.dono, 'ordem', n.ordem,
      'cadencia_min', n.cadencia_min, 'tolerancia_min', n.tolerancia_min,
      'ultimo_batimento', u.fim, 'resultado', u.resultado, 'detalhe', u.detalhe,
      'itens_olhados', u.olh, 'itens_decididos', u.dec,
      'atraso_min', CASE WHEN n.cadencia_min IS NULL OR u.fim IS NULL THEN NULL
                         ELSE round(greatest(extract(epoch FROM (now() - u.fim))/60 - n.cadencia_min, 0)::numeric, 1) END,
      'cor', CASE
        WHEN n.cadencia_min IS NULL THEN 'sem_cadencia'
        WHEN u.fim IS NULL THEN 'sem_dados'   -- ainda sem batimento ligado: cinza, não alarma
        WHEN u.resultado = 'falha' THEN 'vermelho'
        WHEN extract(epoch FROM (now() - u.fim))/60 <= n.cadencia_min THEN 'verde'
        WHEN extract(epoch FROM (now() - u.fim))/60 <= n.cadencia_min + n.tolerancia_min THEN 'amarelo'
        ELSE 'vermelho' END
    ) AS x
    FROM erp_infra_no n
    LEFT JOIN LATERAL (
      SELECT fim, resultado, detalhe, olh, dec FROM (
        (SELECT b.fim, b.resultado, b.detalhe, b.itens_olhados AS olh, b.itens_decididos AS dec
          FROM erp_infra_batimento b WHERE b.no = n.chave ORDER BY b.fim DESC LIMIT 1)
        UNION ALL
        (SELECT d.end_time, CASE WHEN d.status = 'succeeded' THEN 'ok' ELSE 'falha' END, left(coalesce(d.return_message,''), 200), 0, 0
          FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
         WHERE n.cron_jobname IS NOT NULL AND j.jobname = n.cron_jobname AND d.end_time IS NOT NULL
         ORDER BY d.end_time DESC LIMIT 1)
      ) t ORDER BY fim DESC LIMIT 1
    ) u ON true
    WHERE n.versao = (SELECT versao FROM erp_infra_desenho_versao WHERE vigente)
  ) q;
  RETURN jsonb_build_object('ok', true, 'gerado_em', now(), 'nos', r);
END $function$;
REVOKE ALL ON FUNCTION public.fn_infra_estado_interno() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_infra_estado_interno() TO service_role;

CREATE OR REPLACE FUNCTION public.fn_infra_estado() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  RETURN public.fn_infra_estado_interno();
END $function$;
REVOKE ALL ON FUNCTION public.fn_infra_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_infra_estado() TO authenticated, service_role;

-- ── configuração: só PS_ADMIN (Eng. Chefe/CEO), com auditoria ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_infra_config_salvar(p_no text, p_cadencia_min integer, p_tolerancia_min integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ant record;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM ps_equipe_acesso e WHERE e.user_id = auth.uid() AND e.ativo AND e.papel = 'PS_ADMIN') THEN
    RAISE EXCEPTION 'só Eng. Chefe/CEO (PS_ADMIN) altera a configuração';
  END IF;
  IF p_cadencia_min IS NOT NULL AND p_cadencia_min <= 0 THEN RAISE EXCEPTION 'cadência deve ser maior que zero (ou vazia)'; END IF;
  IF coalesce(p_tolerancia_min,-1) < 0 THEN RAISE EXCEPTION 'tolerância não pode ser negativa'; END IF;
  SELECT cadencia_min, tolerancia_min INTO v_ant FROM erp_infra_no
   WHERE chave = p_no AND versao = (SELECT versao FROM erp_infra_desenho_versao WHERE vigente);
  IF NOT FOUND THEN RAISE EXCEPTION 'nó desconhecido'; END IF;
  UPDATE erp_infra_no SET cadencia_min = p_cadencia_min, tolerancia_min = p_tolerancia_min
   WHERE chave = p_no AND versao = (SELECT versao FROM erp_infra_desenho_versao WHERE vigente);
  BEGIN
    INSERT INTO audit_log_global (acao, detalhes) VALUES ('infra_config_salvar',
      jsonb_build_object('no', p_no, 'antes', to_jsonb(v_ant), 'depois', jsonb_build_object('cadencia_min', p_cadencia_min, 'tolerancia_min', p_tolerancia_min), 'user_id', auth.uid()));
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_infra_config_salvar(text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_infra_config_salvar(text,integer,integer) TO authenticated, service_role;

-- ── alerta: nó vermelho (com cadência) avisa o CEO pelo canal do briefing, uma vez por episódio ──────────────────
CREATE OR REPLACE FUNCTION public.fn_infra_alertar() RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
-- ci-sem-guarda: rotina interna de pg_cron, sem parâmetro e só service_role
DECLARE n jsonb; v_cnt integer := 0; v_rule text;
BEGIN
  FOR n IN SELECT * FROM jsonb_array_elements(
      (SELECT jsonb_agg(x) FROM jsonb_array_elements(public.fn_infra_estado_interno()->'nos') x WHERE x->>'cor' = 'vermelho')) LOOP
    v_rule := 'infra_no_parado:' || (n->>'chave');
    IF NOT EXISTS (SELECT 1 FROM erp_truth_alerts WHERE rule_id = v_rule AND status = 'novo') THEN
      INSERT INTO erp_truth_alerts (rule_id, severity, area, tipo_divergencia, mensagem, recomendacao, status)
      VALUES (v_rule, 'high', 'dev', 'infra_no_parado',
        'Mapa da Infra: "' || (n->>'nome') || '" fora da tolerância (cadência ' || coalesce(n->>'cadencia_min','—') || ' min + ' || (n->>'tolerancia_min') || ' min). Último batimento: ' || coalesce(n->>'ultimo_batimento','nunca') || '.',
        'Abrir /dashboard/dev/infra e checar o nó (dono: ' || (n->>'dono') || ').', 'novo');
      v_cnt := v_cnt + 1;
    END IF;
  END LOOP;
  RETURN v_cnt;
END $function$;
REVOKE ALL ON FUNCTION public.fn_infra_alertar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_infra_alertar() TO service_role;

-- agenda do alerta (a cada 10 min), idempotente
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dev-infra-alerta-10min') THEN
    PERFORM cron.schedule('dev-infra-alerta-10min', '*/10 * * * *', 'SELECT public.fn_infra_alertar()');
  END IF;
END $$;

-- ── catálogo de telas (RD-50) e "?" (RD-95) ────────────────────────────────────────────────────────────────────────
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, motivo_nao_auditavel, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.dev.infra', '/dashboard/dev/infra', 'admin', 'Central de Desenvolvimento · Mapa da Infra',
       'Fluxograma em tempo real do desenho esperado da infra (esteira, auditores, Codes, bancos de teste): cor por nó (verde na cadência, amarelo atrasado, vermelho parado), último batimento e configuração de cadência/tolerância.',
       'pronto', false, 'Só a equipe PS vê (fn_dev_painel_pode_ver).', now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/dev/infra');

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Infra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/infra', 'dev', 'publicado'
FROM (VALUES
 ('dev.infra.no', 'Nó do mapa', 'Nada a preencher: cada caixa é uma peça da infra (cron, workflow, Code, banco).', 'Mostra se a peça está batendo no ritmo esperado do desenho.', 'Revisor verde: bateu há menos de 5 min.', 'Achar que cinza é problema: cinza é peça por evento, sem cadência.', 1),
 ('dev.infra.cor', 'Cor do nó', 'Nada a preencher: verde = na cadência; amarelo = atrasado dentro da tolerância; vermelho = parado ou com falha.', 'Diz onde agir primeiro; vermelho avisa o CEO pelo briefing.', 'Cadência 10 min + tolerância 10: vermelho após 20 min sem bater.', 'Ignorar o amarelo: ele é o aviso antes do vermelho.', 2),
 ('dev.infra.cadencia', 'Cadência (min)', 'Minutos entre uma rodada e a seguinte. Vazio = nó por evento.', 'Base para decidir se o nó está atrasado.', '5 para o revisor.', 'Pôr a cadência menor que o real: o nó fica sempre amarelo.', 3),
 ('dev.infra.tolerancia', 'Tolerância (min)', 'Minutos extras aceitos além da cadência antes de ficar vermelho.', 'Evita alarme falso por atraso normal.', '10 min sobre cadência de 10.', 'Tolerância zero em cron que costuma atrasar.', 4),
 ('dev.infra.batimento', 'Último batimento', 'Nada a preencher: hora do fim da última rodada registrada.', 'Prova que o nó trabalhou, com itens olhados e decididos.', '14:05 · olhou 6, decidiu 2.', 'Confundir início com fim da rodada.', 5),
 ('dev.infra.config', 'Configuração', 'Ajuste cadência e tolerância do nó e salve. Só Eng. Chefe/CEO.', 'Mantém o desenho esperado fiel à realidade; cada mudança fica em auditoria.', 'Revisor de 5 para 3 min.', 'Mudar o desenho para esconder um nó parado.', 6)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
