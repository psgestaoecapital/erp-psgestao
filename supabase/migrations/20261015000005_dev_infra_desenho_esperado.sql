-- Aba Codes · "Mapa da Infra", fatia 1: desenho esperado versionado + batimento (msg 2da79cd2, CEO 14/10). Faixa 05 (gilberto-produto).
-- Só objetos NOVOS (aditiva): leitura só equipe PS (fn_dev_painel_pode_ver), gravação só service_role, nada ao anon.

CREATE TABLE IF NOT EXISTS public.erp_dev_infra_versao (
  versao      integer PRIMARY KEY,
  vigente     boolean NOT NULL DEFAULT false,
  nota        text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_dev_infra_versao_vigente_uq ON public.erp_dev_infra_versao (vigente) WHERE vigente;

CREATE TABLE IF NOT EXISTS public.erp_dev_infra_no (
  versao          integer NOT NULL REFERENCES public.erp_dev_infra_versao(versao),
  chave           text    NOT NULL,
  nome            text    NOT NULL,
  camada          text    NOT NULL CHECK (camada IN ('sistemas','esteira','banco_teste','producao','auditor','agente')),
  dono            text    NOT NULL,
  cadencia_min    integer NOT NULL CHECK (cadencia_min > 0),
  tolerancia_min  integer NOT NULL CHECK (tolerancia_min >= 0),
  fonte_batimento text    NOT NULL DEFAULT 'batimento' CHECK (fonte_batimento IN ('batimento','cron','lease','esteira')),
  PRIMARY KEY (versao, chave)
);

CREATE TABLE IF NOT EXISTS public.erp_dev_infra_ligacao (
  versao  integer NOT NULL REFERENCES public.erp_dev_infra_versao(versao),
  origem  text NOT NULL,
  destino text NOT NULL,
  rotulo  text,
  PRIMARY KEY (versao, origem, destino),
  FOREIGN KEY (versao, origem)  REFERENCES public.erp_dev_infra_no(versao, chave),
  FOREIGN KEY (versao, destino) REFERENCES public.erp_dev_infra_no(versao, chave)
);

CREATE TABLE IF NOT EXISTS public.erp_dev_infra_batimento (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  no_chave    text NOT NULL,
  inicio      timestamptz NOT NULL,
  fim         timestamptz NOT NULL DEFAULT now(),
  olhados     integer NOT NULL DEFAULT 0,
  decididos   integer NOT NULL DEFAULT 0,
  resultado   text NOT NULL DEFAULT 'ok' CHECK (resultado IN ('ok','erro','parcial')),
  detalhe     text
);
CREATE INDEX IF NOT EXISTS erp_dev_infra_batimento_no_idx ON public.erp_dev_infra_batimento (no_chave, fim DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_dev_infra_versao','erp_dev_infra_no','erp_dev_infra_ligacao','erp_dev_infra_batimento'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel_equipe_ps', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver())', t || '_sel_equipe_ps', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='erp_dev_infra_batimento') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.erp_dev_infra_batimento;
  END IF;
END $$;

-- Batimento: chamado ao fim de cada rodada pelo revisor/Codes (canal de serviço). Poda >30 dias.
CREATE OR REPLACE FUNCTION public.fn_dev_infra_batimento_gravar(
  p_no text, p_inicio timestamptz, p_olhados integer DEFAULT 0, p_decididos integer DEFAULT 0,
  p_resultado text DEFAULT 'ok', p_detalhe text DEFAULT NULL) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM erp_dev_infra_no n JOIN erp_dev_infra_versao v USING (versao) WHERE v.vigente AND n.chave = p_no) THEN
    RAISE EXCEPTION 'nó % não existe no desenho vigente', p_no;
  END IF;
  INSERT INTO erp_dev_infra_batimento (no_chave, inicio, olhados, decididos, resultado, detalhe)
  VALUES (p_no, COALESCE(p_inicio, now()), COALESCE(p_olhados,0), COALESCE(p_decididos,0), COALESCE(p_resultado,'ok'), left(p_detalhe, 500))
  RETURNING id INTO v_id;
  DELETE FROM erp_dev_infra_batimento WHERE fim < now() - interval '30 days';
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.fn_dev_infra_batimento_gravar(text,timestamptz,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dev_infra_batimento_gravar(text,timestamptz,integer,integer,text,text) TO service_role;

-- Desenho v1 (cadências a confirmar pelo Eng. Chefe na tela de Configuração).
INSERT INTO erp_dev_infra_versao (versao, vigente, nota) VALUES (1, true, 'Desenho inicial (CEO 14/10)') ON CONFLICT DO NOTHING;
INSERT INTO erp_dev_infra_no (versao, chave, nome, camada, dono, cadencia_min, tolerancia_min, fonte_batimento) VALUES
 (1,'revisor','gilberto-revisor','auditor','eng_chefe',5,10,'batimento'),
 (1,'eng_chefe_auto','eng-chefe-auto','auditor','eng_chefe',60,30,'batimento'),
 (1,'fila_merge','Fila de merge','esteira','gilberto-desenv',5,15,'esteira'),
 (1,'aceitacao_pr','Aceitação da PR','esteira','gilberto-desenv',30,60,'esteira'),
 (1,'aceitacao_main','Aceitação da main','esteira','gilberto-desenv',60,60,'esteira'),
 (1,'deploy_migrations','deploy-migrations','producao','gilberto-desenv',60,120,'esteira'),
 (1,'pos_migration','@pos-migration','producao','gilberto-desenv',60,120,'esteira'),
 (1,'vigia','Vigia de runs','esteira','gilberto-desenv',10,20,'esteira'),
 (1,'despertador','Despertador','agente','eng_chefe',5,15,'cron'),
 (1,'monitor','Monitor','agente','gilberto-desenv',15,30,'batimento'),
 (1,'vaga0','Banco de testes · vaga 0','banco_teste','gilberto-desenv',60,120,'esteira'),
 (1,'vaga1','Banco de testes · vaga 1','banco_teste','gilberto-desenv',60,120,'esteira'),
 (1,'code_produto','gilberto-produto','agente','gilberto-produto',60,180,'lease'),
 (1,'code_desenv','gilberto-desenv','agente','gilberto-desenv',60,180,'lease'),
 (1,'code_chamados','gilberto-chamados','agente','gilberto-chamados',60,180,'lease')
ON CONFLICT DO NOTHING;
INSERT INTO erp_dev_infra_ligacao (versao, origem, destino, rotulo) VALUES
 (1,'code_produto','fila_merge','PR'),(1,'code_desenv','fila_merge','PR'),(1,'code_chamados','fila_merge','PR'),
 (1,'revisor','fila_merge','autoriza'),(1,'fila_merge','aceitacao_pr','checks'),(1,'fila_merge','deploy_migrations','merge'),
 (1,'deploy_migrations','pos_migration','veredito'),(1,'aceitacao_pr','vaga0','testa em'),(1,'aceitacao_main','vaga1','testa em'),
 (1,'vigia','aceitacao_pr','cancela/re-roda'),(1,'despertador','code_produto','acorda'),(1,'monitor','eng_chefe_auto','avisa')
ON CONFLICT DO NOTHING;
