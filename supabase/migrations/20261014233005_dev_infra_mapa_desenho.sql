-- Aba Codes · Mapa da Infra, fatia 1 (msg 2da79cd2): desenho esperado versionado + batimento. Faixa 05 (gilberto-produto).
-- Objetos NOVOS (aditiva): erp_infra_no, erp_infra_ligacao, erp_infra_batimento. Leitura só equipe PS; nada ao anon.
-- Gravação do batimento só por função de serviço (revisor e Codes chamam ao fim de cada rodada).

CREATE TABLE IF NOT EXISTS public.erp_infra_no (
  codigo           text PRIMARY KEY,
  nome             text NOT NULL,
  grupo            text NOT NULL CHECK (grupo IN ('sistema','esteira','banco_teste','producao','auditor','code','agenda')),
  dono             text NOT NULL,
  cadencia_min     integer CHECK (cadencia_min IS NULL OR cadencia_min > 0),
  tolerancia_min   integer NOT NULL DEFAULT 15 CHECK (tolerancia_min > 0),
  fonte_batimento  text NOT NULL DEFAULT 'funcao' CHECK (fonte_batimento IN ('funcao','cron','github','lease')),
  cron_jobname     text,
  versao_desenho   integer NOT NULL DEFAULT 1,
  ativo            boolean NOT NULL DEFAULT true,
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   text
);
CREATE TABLE IF NOT EXISTS public.erp_infra_ligacao (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  de_no      text NOT NULL REFERENCES public.erp_infra_no(codigo),
  para_no    text NOT NULL REFERENCES public.erp_infra_no(codigo),
  rotulo     text,
  versao_desenho integer NOT NULL DEFAULT 1,
  UNIQUE (de_no, para_no)
);
CREATE TABLE IF NOT EXISTS public.erp_infra_batimento (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  no_codigo     text NOT NULL REFERENCES public.erp_infra_no(codigo),
  inicio        timestamptz NOT NULL DEFAULT now(),
  fim           timestamptz NOT NULL DEFAULT now(),
  itens_olhados integer NOT NULL DEFAULT 0,
  decididos     integer NOT NULL DEFAULT 0,
  resultado     text NOT NULL DEFAULT 'ok' CHECK (resultado IN ('ok','vazio','erro')),
  detalhe       text
);
CREATE INDEX IF NOT EXISTS erp_infra_batimento_no_idx ON public.erp_infra_batimento (no_codigo, fim DESC);
COMMENT ON TABLE public.erp_infra_no IS 'Desenho esperado da infra (nós): dono, cadência e tolerância antes de alerta. Versionado por versao_desenho.';
COMMENT ON TABLE public.erp_infra_ligacao IS 'Desenho esperado da infra (ligações entre nós).';
COMMENT ON TABLE public.erp_infra_batimento IS 'Uma linha por rodada de revisor/Code/auditor (crons leem cron.job_run_details). Podado em 30 dias.';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_infra_no','erp_infra_ligacao','erp_infra_batimento'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel_equipe_ps', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver())', t || '_sel_equipe_ps', t);
  END LOOP;
END $$;

INSERT INTO public.erp_infra_no (codigo, nome, grupo, dono, cadencia_min, tolerancia_min, fonte_batimento) VALUES
  ('revisor','Revisor (gilberto-revisor)','auditor','eng_chefe',5,20,'funcao'),
  ('fila_merge','Fila de merge','esteira','eng_chefe',NULL,30,'github'),
  ('aceitacao_pr','Aceitação da PR','esteira','eng_chefe',NULL,60,'github'),
  ('aceitacao_main','Aceitação da main','banco_teste','eng_chefe',60,90,'github'),
  ('deploy_migrations','deploy-migrations','producao','eng_chefe',NULL,30,'github'),
  ('pos_migration','@pos-migration','producao','eng_chefe',NULL,60,'github'),
  ('vigia','Vigia de runs','esteira','eng_chefe',10,25,'github'),
  ('despertador','Despertador dos Codes','agenda','eng_chefe',5,15,'cron'),
  ('monitor','Monitor (gilberto-desenv)','code','gilberto-desenv',NULL,60,'lease'),
  ('vaga_teste_0','Banco de testes · vaga 0','banco_teste','eng_chefe',NULL,120,'funcao'),
  ('vaga_teste_1','Banco de testes · vaga 1','banco_teste','eng_chefe',NULL,120,'funcao'),
  ('code_gilberto_desenv','Code gilberto-desenv','code','gilberto-desenv',NULL,60,'lease'),
  ('code_gilberto_produto','Code gilberto-produto','code','gilberto-produto',NULL,60,'lease'),
  ('code_gilberto_chamados','Code gilberto-chamados','code','gilberto-chamados',NULL,60,'lease'),
  ('code_rodrigo','Code rodrigo-code','code','rodrigo-code',NULL,240,'lease'),
  ('code_jordana','Code jordana-code','code','jordana-code',NULL,240,'lease'),
  ('producao_db','Produção (banco)','producao','eng_chefe',NULL,60,'funcao')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.erp_infra_ligacao (de_no, para_no, rotulo) VALUES
  ('code_gilberto_produto','fila_merge','PR pronta'),('code_gilberto_desenv','fila_merge','PR pronta'),
  ('code_gilberto_chamados','fila_merge','PR pronta'),('code_rodrigo','fila_merge','PR pronta'),('code_jordana','fila_merge','PR pronta'),
  ('revisor','fila_merge','MERGE AUTORIZADO'),('fila_merge','aceitacao_pr','checks'),
  ('aceitacao_pr','vaga_teste_0','suíte'),('aceitacao_pr','vaga_teste_1','suíte'),
  ('fila_merge','deploy_migrations','merge na main'),('deploy_migrations','producao_db','db push'),
  ('deploy_migrations','pos_migration','veredito'),('aceitacao_main','vaga_teste_0','suíte'),
  ('vigia','aceitacao_pr','cancela estourado'),('despertador','code_gilberto_produto','acorda'),
  ('despertador','code_gilberto_desenv','acorda'),('despertador','code_gilberto_chamados','acorda')
ON CONFLICT (de_no, para_no) DO NOTHING;

-- Batimento: revisor e Codes chamam ao fim de cada rodada (só canal de serviço).
CREATE OR REPLACE FUNCTION public.fn_infra_batimento_registrar(
  p_no text, p_inicio timestamptz DEFAULT now(), p_itens_olhados integer DEFAULT 0,
  p_decididos integer DEFAULT 0, p_resultado text DEFAULT 'ok', p_detalhe text DEFAULT NULL) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM erp_infra_no WHERE codigo = p_no AND ativo) THEN
    RAISE EXCEPTION 'nó desconhecido: %', p_no;
  END IF;
  INSERT INTO erp_infra_batimento (no_codigo, inicio, fim, itens_olhados, decididos, resultado, detalhe)
  VALUES (p_no, COALESCE(p_inicio, now()), now(), GREATEST(COALESCE(p_itens_olhados,0),0), GREATEST(COALESCE(p_decididos,0),0),
          COALESCE(p_resultado,'ok'), left(p_detalhe, 500))
  RETURNING id INTO v_id;
  DELETE FROM erp_infra_batimento WHERE no_codigo = p_no AND fim < now() - interval '30 days';
  RETURN v_id;
END $function$;
REVOKE ALL ON FUNCTION public.fn_infra_batimento_registrar(text,timestamptz,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_infra_batimento_registrar(text,timestamptz,integer,integer,text,text) TO service_role;

-- Estado de cada nó: verde na cadência, amarelo atrasado (> tolerância), vermelho parado (> 2× tolerância). Só leitura.
CREATE OR REPLACE FUNCTION public.fn_infra_estado() RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.fn_dev_painel_pode_ver() THEN RAISE EXCEPTION 'sem permissão'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'codigo', n.codigo, 'nome', n.nome, 'grupo', n.grupo, 'dono', n.dono,
      'cadencia_min', n.cadencia_min, 'tolerancia_min', n.tolerancia_min,
      'ultimo_batimento', b.fim, 'resultado', b.resultado, 'itens_olhados', b.itens_olhados,
      'minutos_sem_bater', CASE WHEN b.fim IS NULL THEN NULL ELSE round(EXTRACT(epoch FROM now() - b.fim)/60) END,
      'estado', CASE WHEN b.fim IS NULL THEN 'sem_dado'
                     WHEN now() - b.fim <= make_interval(mins => n.tolerancia_min) THEN 'verde'
                     WHEN now() - b.fim <= make_interval(mins => 2*n.tolerancia_min) THEN 'amarelo'
                     ELSE 'vermelho' END) ORDER BY n.grupo, n.codigo)
    FROM erp_infra_no n
    LEFT JOIN LATERAL (SELECT fim, resultado, itens_olhados FROM erp_infra_batimento x WHERE x.no_codigo = n.codigo ORDER BY fim DESC LIMIT 1) b ON true
    WHERE n.ativo), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.fn_infra_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_infra_estado() TO authenticated, service_role;
