-- Aba Codes › "Mapa da Infra" (CEO 14/10) — FATIA 1: desenho esperado + batimento. Faixa 05 (gilberto-produto).
-- (1) erp_infra_no / erp_infra_ligacao: o DESENHO ESPERADO da esteira (nós, ligações, dono, cadência, tolerância),
--     versionado em erp_infra_desenho_versao (cada mudança de configuração grava versão nova + auditoria).
-- (2) erp_infra_batimento: uma linha por rodada (início, fim, itens olhados/decididos, resultado) — gravada por função de
--     serviço (revisor e Codes); crons são lidos direto de cron.job_run_details.
-- Aditiva: só objetos novos, RLS ligada, leitura só equipe PS (fn_dev_painel_pode_ver), REVOKE anon, Realtime.
-- Sem dado de cliente. Config editável só por PS_ADMIN (Eng. Chefe/CEO), com auditoria.

CREATE TABLE IF NOT EXISTS public.erp_infra_desenho_versao (
  versao     integer PRIMARY KEY,
  motivo     text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  criado_por text NOT NULL DEFAULT 'sistema'
);

CREATE TABLE IF NOT EXISTS public.erp_infra_no (
  chave             text PRIMARY KEY CHECK (chave ~ '^[a-z0-9_-]+$'),
  nome              text NOT NULL,
  tipo              text NOT NULL CHECK (tipo IN ('sistema','esteira','banco_teste','producao','auditor','code','agenda','revisor')),
  fonte             text NOT NULL CHECK (fonte IN ('cron','batimento','esteira_status','lease','manual')),
  fonte_ref         text,                       -- jobname do cron / identificador do batimento
  dono              text NOT NULL,
  cadencia_min      integer CHECK (cadencia_min > 0),   -- NULL = sob demanda (sem alerta de atraso)
  tolerancia_min    integer NOT NULL DEFAULT 10 CHECK (tolerancia_min >= 0),
  ordem             integer NOT NULL DEFAULT 0,
  ativo             boolean NOT NULL DEFAULT true,
  descricao         text NOT NULL DEFAULT '',
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.erp_infra_ligacao (
  de       text NOT NULL REFERENCES public.erp_infra_no(chave) ON DELETE CASCADE,
  para     text NOT NULL REFERENCES public.erp_infra_no(chave) ON DELETE CASCADE,
  rotulo   text NOT NULL DEFAULT '',
  PRIMARY KEY (de, para)
);

CREATE TABLE IF NOT EXISTS public.erp_infra_batimento (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  no_chave     text NOT NULL REFERENCES public.erp_infra_no(chave) ON DELETE CASCADE,
  inicio       timestamptz NOT NULL DEFAULT now(),
  fim          timestamptz,
  itens_olhados  integer NOT NULL DEFAULT 0 CHECK (itens_olhados >= 0),
  itens_decididos integer NOT NULL DEFAULT 0 CHECK (itens_decididos >= 0),
  resultado    text NOT NULL DEFAULT 'ok' CHECK (resultado IN ('ok','sem_pendencia','erro','parcial')),
  detalhe      text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_infra_batimento_no_idx ON public.erp_infra_batimento (no_chave, criado_em DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_infra_desenho_versao','erp_infra_no','erp_infra_ligacao','erp_infra_batimento'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel_ps', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver())', t || '_sel_ps', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['erp_infra_no','erp_infra_batimento'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ── desenho esperado v1 (valores iniciais; cadência/tolerância editáveis na tela) ────────────────────────────────
INSERT INTO public.erp_infra_desenho_versao (versao, motivo, criado_por) VALUES (1, 'Desenho inicial (CEO 14/10)', 'gilberto-produto')
ON CONFLICT DO NOTHING;

INSERT INTO public.erp_infra_no (chave, nome, tipo, fonte, fonte_ref, dono, cadencia_min, tolerancia_min, ordem, descricao) VALUES
 ('sistemas',          'Sistemas (ERP em produção)',      'sistema',    'manual',         NULL,                       'eng_chefe',          NULL, 0, 10, 'Onde o cliente usa o ERP.'),
 ('code-desenv',       'Code gilberto-desenv',            'code',       'lease',          'gilberto-desenv',          'eng_chefe',          NULL, 0, 20, 'Núcleo compartilhado.'),
 ('code-produto',      'Code gilberto-produto',           'code',       'lease',          'gilberto-produto',         'eng_chefe',          NULL, 0, 21, 'Hub, P&M e aba Codes.'),
 ('code-chamados',     'Code gilberto-chamados',          'code',       'lease',          'gilberto-chamados',        'eng_chefe',          NULL, 0, 22, 'Chamados e PDCA.'),
 ('revisor',           'Revisor (gilberto-revisor)',      'revisor',    'batimento',      'gilberto-revisor',         'eng_chefe',          5,   10, 30, 'Autoriza PRs com revisao-eng-chefe; varredura a cada 5 min.'),
 ('fila-merge',        'Fila de merge',                   'esteira',    'esteira_status', 'fila-merge',               'eng_chefe',          NULL, 0, 40, 'Publica PRs Ready na main.'),
 ('aceitacao-pr',      'Aceitação da PR',                 'esteira',    'esteira_status', 'aceitacao-pr',             'eng_chefe',          NULL, 0, 41, 'Suíte no preview da PR (via revisada).'),
 ('aceitacao-main',    'Aceitação da main',               'esteira',    'esteira_status', 'aceitacao-main',           'eng_chefe',          NULL, 0, 42, 'De hora em hora contra o banco de testes.'),
 ('vaga-0',            'Banco de testes — vaga 0',        'banco_teste','manual',         NULL,                       'eng_chefe',          NULL, 0, 50, 'Ledger igual à produção? sobras? última atividade.'),
 ('vaga-1',            'Banco de testes — vaga 1',        'banco_teste','manual',         NULL,                       'eng_chefe',          NULL, 0, 51, '2ª vaga de aceitação.'),
 ('deploy-migrations', 'deploy-migrations',               'esteira',    'esteira_status', 'deploy-migrations',        'eng_chefe',          NULL, 0, 60, 'db push na main.'),
 ('pos-migration',     '@pos-migration',                  'esteira',    'esteira_status', 'aceitacao-pos-migration',  'eng_chefe',          NULL, 0, 61, 'Veredito em produção após a migration.'),
 ('producao',          'Produção (Supabase + Vercel)',    'producao',   'manual',         NULL,                       'eng_chefe',          NULL, 0, 70, 'Banco e app dos clientes.'),
 ('vigia',             'Vigia de runs',                   'agenda',     'cron',           'vigia-coleta-agentes',     'eng_chefe',          10,  15, 80, 'Cancela run estourado e re-roda cancelado.'),
 ('despertador',       'Despertador dos Codes',           'agenda',     'cron',           'agente_despertador',       'eng_chefe',          30,  35, 81, 'Acorda Code com tarefa parada.'),
 ('monitor',           'Monitor da main',                 'agenda',     'cron',           'monitor-merge-tick',       'eng_chefe',          5,   10, 82, 'Tick de merge/main.'),
 ('alerta-main',       'Alerta main vermelha',            'agenda',     'cron',           'dev-main-vermelha-alerta', 'eng_chefe',          10,  15, 83, 'Avisa o CEO se a main/deploy cair.'),
 ('snapshot-codes',    'Snapshot da aba Codes',           'agenda',     'cron',           'dev-codes-snapshot-15min', 'gilberto-produto',   15,  20, 84, 'Histórico a cada 15 min.'),
 ('auditor-matriz',    'Auditor da matriz',               'auditor',    'cron',           'auditor-matriz-consultar-5min','eng_chefe',      5,   10, 90, 'Auditor de permissões/matriz.'),
 ('auditor-dre',       'Auditor da verdade (DRE)',        'auditor',    'cron',           'truth-auditor-dre-1h',     'eng_chefe',          60,  20, 91, 'Confere DRE x lançamentos.'),
 ('auditor-drift',     'Auditor de drift (RD-35)',        'auditor',    'cron',           'rd35-detectar-drift-15min','eng_chefe',          15,  20, 92, 'Detecta divergência de ledger/schema.')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.erp_infra_ligacao (de, para, rotulo) VALUES
 ('code-desenv','fila-merge','PR Ready'), ('code-produto','fila-merge','PR Ready'), ('code-chamados','fila-merge','PR Ready'),
 ('revisor','fila-merge','MERGE AUTORIZADO'),
 ('fila-merge','aceitacao-pr','checks'), ('aceitacao-pr','vaga-0','roda em'), ('aceitacao-pr','vaga-1','roda em'),
 ('fila-merge','deploy-migrations','merge na main'), ('deploy-migrations','producao','db push'),
 ('deploy-migrations','pos-migration','então'), ('pos-migration','producao','prova em'),
 ('aceitacao-main','vaga-0','roda em'), ('producao','sistemas','serve'),
 ('vigia','aceitacao-pr','re-roda/cancela'), ('despertador','code-produto','acorda'),
 ('monitor','fila-merge','vigia'), ('alerta-main','monitor','lê'),
 ('auditor-matriz','producao','audita'), ('auditor-dre','producao','audita'), ('auditor-drift','producao','audita')
ON CONFLICT DO NOTHING;

-- ── batimento: gravado pelo revisor e pelos Codes ao fim de cada rodada (só service_role) ─────────────────────────
-- ci-sem-guarda: fn_infra_batimento_registrar — meta da esteira, sem company_id nem dado de cliente; só service_role.
CREATE OR REPLACE FUNCTION public.fn_infra_batimento_registrar(
  p_no text, p_inicio timestamptz, p_fim timestamptz DEFAULT now(),
  p_olhados integer DEFAULT 0, p_decididos integer DEFAULT 0, p_resultado text DEFAULT 'ok', p_detalhe text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM erp_infra_no WHERE chave = p_no) THEN
    RAISE EXCEPTION 'nó desconhecido: %', p_no USING errcode = '22023';
  END IF;
  INSERT INTO erp_infra_batimento (no_chave, inicio, fim, itens_olhados, itens_decididos, resultado, detalhe)
  VALUES (p_no, coalesce(p_inicio, now()), p_fim, greatest(coalesce(p_olhados,0),0), greatest(coalesce(p_decididos,0),0),
          coalesce(p_resultado,'ok'), left(p_detalhe, 500))
  RETURNING id INTO v_id;
  DELETE FROM erp_infra_batimento WHERE no_chave = p_no AND criado_em < now() - interval '30 days';
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fn_infra_batimento_registrar(text,timestamptz,timestamptz,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_infra_batimento_registrar(text,timestamptz,timestamptz,integer,integer,text,text) TO service_role;

-- ── configuração: cadência/tolerância (só PS_ADMIN = Eng. Chefe/CEO), com versão + auditoria ────────────────────
-- ci-sem-guarda: fn_infra_no_configurar — erp_infra_no é meta da esteira (sem empresa); guarda = PS_ADMIN ativo.
CREATE OR REPLACE FUNCTION public.fn_infra_no_configurar(p_no text, p_cadencia_min integer, p_tolerancia_min integer, p_motivo text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ver integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ps_equipe_acesso e WHERE e.user_id = auth.uid() AND e.ativo AND e.papel = 'PS_ADMIN') THEN
    RAISE EXCEPTION 'sem permissão' USING errcode = '42501';
  END IF;
  IF coalesce(btrim(p_motivo),'') = '' THEN RAISE EXCEPTION 'motivo obrigatório' USING errcode = '22023'; END IF;
  UPDATE erp_infra_no SET cadencia_min = p_cadencia_min, tolerancia_min = coalesce(p_tolerancia_min, tolerancia_min), atualizado_em = now()
   WHERE chave = p_no;
  IF NOT FOUND THEN RAISE EXCEPTION 'nó desconhecido: %', p_no USING errcode = '22023'; END IF;
  SELECT coalesce(max(versao),0)+1 INTO v_ver FROM erp_infra_desenho_versao;
  INSERT INTO erp_infra_desenho_versao (versao, motivo, criado_por)
  VALUES (v_ver, left(p_no || ': cadência ' || coalesce(p_cadencia_min::text,'sob demanda') || ' / tolerância ' || coalesce(p_tolerancia_min::text,'-') || ' — ' || p_motivo, 500), auth.uid()::text);
  RETURN v_ver;
END $$;
REVOKE ALL ON FUNCTION public.fn_infra_no_configurar(text,integer,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_infra_no_configurar(text,integer,integer,text) TO authenticated, service_role;

-- ── leitura do mapa: nós + estado (verde/amarelo/vermelho) + ligações ───────────────────────────────────────────
-- Estado só é calculado para nó com cadência. Último batimento: cron → cron.job_run_details; revisor/Code → erp_infra_batimento.
-- Leve: 1 consulta por nó com índice (jobid/start_time), sem varrer a tabela inteira.
CREATE OR REPLACE FUNCTION public.fn_infra_mapa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão' USING errcode = '42501'; END IF;
  SELECT jsonb_build_object(
    'versao', (SELECT max(versao) FROM erp_infra_desenho_versao),
    'nos', (SELECT coalesce(jsonb_agg(n ORDER BY (n->>'ordem')::int), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'chave', x.chave, 'nome', x.nome, 'tipo', x.tipo, 'fonte', x.fonte, 'dono', x.dono, 'ordem', x.ordem,
        'cadencia_min', x.cadencia_min, 'tolerancia_min', x.tolerancia_min, 'descricao', x.descricao,
        'ultimo_batimento', x.ult,
        'atraso_min', CASE WHEN x.ult IS NULL OR x.cadencia_min IS NULL THEN NULL
                           ELSE round(extract(epoch FROM now() - x.ult)/60 - x.cadencia_min) END,
        'estado', CASE WHEN x.cadencia_min IS NULL THEN 'sem_cadencia'
                       WHEN x.ult IS NULL THEN 'vermelho'
                       WHEN extract(epoch FROM now() - x.ult)/60 <= x.cadencia_min THEN 'verde'
                       WHEN extract(epoch FROM now() - x.ult)/60 <= x.cadencia_min + x.tolerancia_min THEN 'amarelo'
                       ELSE 'vermelho' END) AS n
      FROM (
        SELECT nn.*,
          CASE nn.fonte
            WHEN 'cron' THEN (SELECT max(d.start_time) FROM cron.job_run_details d
                               WHERE d.jobid = (SELECT jobid FROM cron.job j WHERE j.jobname = nn.fonte_ref LIMIT 1)
                                 AND d.start_time > now() - interval '2 days')
            WHEN 'batimento' THEN (SELECT max(b.criado_em) FROM erp_infra_batimento b WHERE b.no_chave = nn.chave)
            ELSE NULL END AS ult
        FROM erp_infra_no nn WHERE nn.ativo
      ) x) q),
    'ligacoes', (SELECT coalesce(jsonb_agg(jsonb_build_object('de', de, 'para', para, 'rotulo', rotulo)), '[]'::jsonb) FROM erp_infra_ligacao)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.fn_infra_mapa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_infra_mapa() TO authenticated, service_role;

-- system_screens / menu: entram na fatia da TELA (/dashboard/dev/infra), junto com o "?" (RD-95).
