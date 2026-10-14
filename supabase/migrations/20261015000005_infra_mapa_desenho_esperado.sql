-- Mapa da Infra (aba Codes, CEO 14/10) — fatia 1: desenho esperado versionado + batimento. Migration ADITIVA.
-- Nós e ligações do desenho esperado, cadência/tolerância por nó, e uma linha de batimento por rodada.
-- Leitura só equipe PS (fn_dev_painel_pode_ver); escrita só service_role; REVOKE anon; Realtime.

CREATE TABLE IF NOT EXISTS public.erp_infra_desenho_versao (
  versao      integer PRIMARY KEY CHECK (versao > 0),
  descricao   text NOT NULL DEFAULT '',
  vigente     boolean NOT NULL DEFAULT false,
  criado_por  text NOT NULL DEFAULT '',
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_infra_desenho_versao_vigente_uk ON public.erp_infra_desenho_versao ((true)) WHERE vigente;

CREATE TABLE IF NOT EXISTS public.erp_infra_no (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  versao              integer NOT NULL REFERENCES public.erp_infra_desenho_versao(versao),
  chave               text NOT NULL,
  nome                text NOT NULL,
  camada              text NOT NULL CHECK (camada IN ('sistemas','esteira','banco_teste','producao','auditor','code')),
  dono                text NOT NULL DEFAULT '',
  fonte_batimento     text NOT NULL DEFAULT 'funcao' CHECK (fonte_batimento IN ('cron','funcao','workflow','lease')),
  cadencia_min        integer CHECK (cadencia_min IS NULL OR cadencia_min > 0),
  tolerancia_min      integer NOT NULL DEFAULT 15 CHECK (tolerancia_min > 0),
  ativo               boolean NOT NULL DEFAULT true,
  atualizado_por      text NOT NULL DEFAULT '',
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_infra_no_versao_chave_key UNIQUE (versao, chave)
);

CREATE TABLE IF NOT EXISTS public.erp_infra_ligacao (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  versao   integer NOT NULL REFERENCES public.erp_infra_desenho_versao(versao),
  de_chave text NOT NULL,
  para_chave text NOT NULL,
  rotulo   text NOT NULL DEFAULT '',
  CONSTRAINT erp_infra_ligacao_key UNIQUE (versao, de_chave, para_chave)
);

CREATE TABLE IF NOT EXISTS public.erp_infra_batimento (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  no_chave    text NOT NULL,
  inicio_em   timestamptz NOT NULL DEFAULT now(),
  fim_em      timestamptz,
  itens_olhados integer NOT NULL DEFAULT 0 CHECK (itens_olhados >= 0),
  decididos   integer NOT NULL DEFAULT 0 CHECK (decididos >= 0),
  resultado   text NOT NULL DEFAULT 'ok' CHECK (resultado IN ('ok','vazio','erro','parcial')),
  detalhe     text NOT NULL DEFAULT '',
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_infra_batimento_no_idx ON public.erp_infra_batimento (no_chave, inicio_em DESC);

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
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t)
       AND EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Batimento: cada rodada do revisor / de um Code grava uma linha (só canal de serviço).
CREATE OR REPLACE FUNCTION public.fn_infra_batimento_registrar(
  p_no_chave text, p_inicio_em timestamptz DEFAULT now(), p_fim_em timestamptz DEFAULT now(),
  p_itens_olhados integer DEFAULT 0, p_decididos integer DEFAULT 0, p_resultado text DEFAULT 'ok', p_detalhe text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_id bigint;
BEGIN
  IF coalesce(auth.role(), current_setting('request.jwt.claim.role', true), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'somente canal de serviço';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_infra_no n JOIN erp_infra_desenho_versao v ON v.versao = n.versao AND v.vigente WHERE n.chave = p_no_chave) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nó fora do desenho vigente');
  END IF;
  INSERT INTO erp_infra_batimento(no_chave, inicio_em, fim_em, itens_olhados, decididos, resultado, detalhe)
  VALUES (p_no_chave, p_inicio_em, p_fim_em, greatest(p_itens_olhados,0), greatest(p_decididos,0), p_resultado, left(coalesce(p_detalhe,''), 500))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $f$;
REVOKE ALL ON FUNCTION public.fn_infra_batimento_registrar(text, timestamptz, timestamptz, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_infra_batimento_registrar(text, timestamptz, timestamptz, integer, integer, text, text) TO service_role;

-- Desenho esperado v1 (cadências iniciais de referência; editáveis pelo Eng. Chefe/CEO na fatia de Configuração).
INSERT INTO public.erp_infra_desenho_versao(versao, descricao, vigente, criado_por)
VALUES (1, 'Desenho inicial: sistemas → esteira → bancos de teste → produção → auditores', true, 'gilberto-produto')
ON CONFLICT (versao) DO NOTHING;

INSERT INTO public.erp_infra_no(versao, chave, nome, camada, dono, fonte_batimento, cadencia_min, tolerancia_min, atualizado_por) VALUES
 (1,'revisor','gilberto-revisor','auditor','eng_chefe','funcao',5,15,'gilberto-produto'),
 (1,'fila_merge','Fila de merge','esteira','eng_chefe','workflow',NULL,30,'gilberto-produto'),
 (1,'aceitacao_pr','Aceitação da PR','esteira','eng_chefe','workflow',NULL,60,'gilberto-produto'),
 (1,'aceitacao_main','Aceitação da main','esteira','eng_chefe','workflow',60,90,'gilberto-produto'),
 (1,'deploy_migrations','deploy-migrations','producao','eng_chefe','workflow',NULL,30,'gilberto-produto'),
 (1,'pos_migration','@pos-migration','producao','eng_chefe','workflow',NULL,60,'gilberto-produto'),
 (1,'vigia','Vigia de runs','esteira','eng_chefe','workflow',10,20,'gilberto-produto'),
 (1,'despertador','Despertador dos Codes','esteira','eng_chefe','cron',5,15,'gilberto-produto'),
 (1,'monitor','Monitor reativo','auditor','eng_chefe','funcao',15,30,'gilberto-produto'),
 (1,'vaga_0','Banco de testes · vaga 0','banco_teste','eng_chefe','workflow',NULL,120,'gilberto-produto'),
 (1,'vaga_1','Banco de testes · vaga 1','banco_teste','eng_chefe','workflow',NULL,120,'gilberto-produto'),
 (1,'code_gilberto_desenv','gilberto-desenv','code','gilberto','lease',NULL,240,'gilberto-produto'),
 (1,'code_gilberto_produto','gilberto-produto','code','gilberto','lease',NULL,240,'gilberto-produto'),
 (1,'code_gilberto_chamados','gilberto-chamados','code','gilberto','lease',NULL,240,'gilberto-produto')
ON CONFLICT (versao, chave) DO NOTHING;

INSERT INTO public.erp_infra_ligacao(versao, de_chave, para_chave, rotulo) VALUES
 (1,'code_gilberto_desenv','fila_merge','PR pronta'),(1,'code_gilberto_produto','fila_merge','PR pronta'),(1,'code_gilberto_chamados','fila_merge','PR pronta'),
 (1,'revisor','fila_merge','MERGE AUTORIZADO'),(1,'fila_merge','aceitacao_pr','checks'),(1,'aceitacao_pr','vaga_0','roda no banco de testes'),
 (1,'fila_merge','deploy_migrations','merge na main'),(1,'deploy_migrations','pos_migration','migration aplicada'),
 (1,'aceitacao_main','vaga_1','roda no banco de testes'),(1,'vigia','aceitacao_pr','cancela estourado'),(1,'despertador','code_gilberto_produto','acorda')
ON CONFLICT (versao, de_chave, para_chave) DO NOTHING;
