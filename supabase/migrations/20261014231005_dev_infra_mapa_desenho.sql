-- Aba Codes · "Mapa da Infra" fatia 1 (msg 2da79cd2, CEO 14/10): desenho esperado versionado + batimento. Faixa 05 (gilberto-produto).
-- Migration ADITIVA: 3 tabelas novas (nós, ligações, batimento). Leitura só equipe PS (fn_dev_painel_pode_ver); escrita só
-- service_role; REVOKE anon. Sem alterar objeto existente nem dado de cliente.

CREATE TABLE IF NOT EXISTS public.erp_dev_infra_no (
  chave             text PRIMARY KEY CHECK (chave ~ '^[a-z0-9_-]+$'),
  nome              text NOT NULL,
  tipo              text NOT NULL CHECK (tipo IN ('code','revisor','auditor','esteira','aceitacao','deploy','vigia','despertador','monitor','banco_teste','producao')),
  dono              text NOT NULL DEFAULT '',
  cadencia_min      integer CHECK (cadencia_min > 0),
  tolerancia_min    integer NOT NULL DEFAULT 10 CHECK (tolerancia_min >= 0),
  versao_desenho    integer NOT NULL DEFAULT 1,
  ativo             boolean NOT NULL DEFAULT true,
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_por    text
);
CREATE TABLE IF NOT EXISTS public.erp_dev_infra_ligacao (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  de_no        text NOT NULL REFERENCES public.erp_dev_infra_no(chave) ON DELETE CASCADE,
  para_no      text NOT NULL REFERENCES public.erp_dev_infra_no(chave) ON DELETE CASCADE,
  rotulo       text NOT NULL DEFAULT '',
  versao_desenho integer NOT NULL DEFAULT 1,
  UNIQUE (de_no, para_no)
);
CREATE TABLE IF NOT EXISTS public.erp_dev_infra_batimento (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  no_chave     text NOT NULL REFERENCES public.erp_dev_infra_no(chave) ON DELETE CASCADE,
  inicio       timestamptz NOT NULL DEFAULT now(),
  fim          timestamptz,
  itens_olhados integer NOT NULL DEFAULT 0,
  decididos    integer NOT NULL DEFAULT 0,
  resultado    text NOT NULL DEFAULT 'ok' CHECK (resultado IN ('ok','erro','vazio')),
  detalhe      text
);
CREATE INDEX IF NOT EXISTS erp_dev_infra_batimento_no_idx ON public.erp_dev_infra_batimento (no_chave, inicio DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_dev_infra_no','erp_dev_infra_ligacao','erp_dev_infra_batimento'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel_equipe_ps', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver())', t || '_sel_equipe_ps', t);
  END LOOP;
END $$;

-- batimento: chamado ao fim de cada rodada (revisor, Codes) pela conexão de serviço
CREATE OR REPLACE FUNCTION public.fn_infra_batimento_registrar(p_no text, p_inicio timestamptz, p_itens integer DEFAULT 0,
  p_decididos integer DEFAULT 0, p_resultado text DEFAULT 'ok', p_detalhe text DEFAULT NULL) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id bigint;
BEGIN
  INSERT INTO erp_dev_infra_batimento (no_chave, inicio, fim, itens_olhados, decididos, resultado, detalhe)
  VALUES (p_no, COALESCE(p_inicio, now()), now(), COALESCE(p_itens,0), COALESCE(p_decididos,0), COALESCE(p_resultado,'ok'), p_detalhe)
  RETURNING id INTO v_id;
  DELETE FROM erp_dev_infra_batimento WHERE no_chave = p_no AND inicio < now() - interval '30 days';
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.fn_infra_batimento_registrar(text,timestamptz,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_infra_batimento_registrar(text,timestamptz,integer,integer,text,text) TO service_role;

-- desenho esperado v1 (cadências a confirmar pelo Eng. Chefe na tela de Configuração)
INSERT INTO erp_dev_infra_no (chave,nome,tipo,dono,cadencia_min,tolerancia_min) VALUES
 ('revisor','gilberto-revisor','revisor','eng_chefe',5,15),
 ('fila_merge','Fila de merge','esteira','gilberto-desenv',NULL,15),
 ('aceitacao_pr','Aceitação da PR','aceitacao','gilberto-desenv',NULL,45),
 ('aceitacao_main','Aceitação da main','aceitacao','gilberto-desenv',60,30),
 ('deploy_migrations','deploy-migrations','deploy','gilberto-desenv',NULL,20),
 ('pos_migration','@pos-migration','aceitacao','gilberto-desenv',NULL,45),
 ('vigia','Vigia de runs','vigia','gilberto-desenv',10,10),
 ('despertador','Despertador','despertador','gilberto-desenv',5,10),
 ('monitor','Monitor','monitor','gilberto-produto',15,10),
 ('vaga_0','Banco de testes — vaga 0','banco_teste','gilberto-desenv',NULL,60),
 ('vaga_1','Banco de testes — vaga 1','banco_teste','gilberto-desenv',NULL,60),
 ('producao','Produção','producao','gilberto-desenv',NULL,15),
 ('code_gilberto-desenv','Code gilberto-desenv','code','gilberto-desenv',NULL,120),
 ('code_gilberto-produto','Code gilberto-produto','code','gilberto-produto',NULL,120),
 ('code_gilberto-chamados','Code gilberto-chamados','code','gilberto-chamados',NULL,120)
ON CONFLICT (chave) DO NOTHING;
INSERT INTO erp_dev_infra_ligacao (de_no,para_no,rotulo) VALUES
 ('code_gilberto-desenv','fila_merge','PR'),('code_gilberto-produto','fila_merge','PR'),('code_gilberto-chamados','fila_merge','PR'),
 ('revisor','fila_merge','autoriza'),('fila_merge','aceitacao_pr','checks'),('aceitacao_pr','vaga_0','roda em'),('aceitacao_pr','vaga_1','roda em'),
 ('fila_merge','deploy_migrations','merge'),('deploy_migrations','producao','aplica'),('deploy_migrations','pos_migration','dispara'),
 ('aceitacao_main','vaga_0','roda em'),('vigia','aceitacao_pr','cancela estouro'),('despertador','code_gilberto-produto','acorda')
ON CONFLICT (de_no,para_no) DO NOTHING;

-- system_screens e a tela /dashboard/dev/infra entram na fatia 2.
