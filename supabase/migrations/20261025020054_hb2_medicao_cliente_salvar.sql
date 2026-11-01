-- HB2 · Medição ao cliente (tela 273) — SALVAR e listar a medição do período. Antes a medição só calculava na tela.
-- Aditiva: 2 tabelas NOVAS (RLS por empresa, só leitura direta) e 2 funções NOVAS com guarda de empresa.
-- A gravação RECALCULA no servidor por fn_tabela_preco_medir (mesma regra do contrato): o total salvo bate com o contrato.
CREATE TABLE IF NOT EXISTS public.erp_medicao_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.erp_tabela_preco_cliente(id),
  descricao text NOT NULL,
  periodo_inicio date,
  periodo_fim date,
  total numeric(14,2) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid()
);
CREATE TABLE IF NOT EXISTS public.erp_medicao_cliente_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  medicao_id uuid NOT NULL REFERENCES public.erp_medicao_cliente(id) ON DELETE CASCADE,
  servico_ref text NOT NULL,
  unidade text,
  quantidade numeric NOT NULL,
  condicao text NOT NULL DEFAULT 'normal',
  faixa_de numeric,
  faixa_ate numeric,
  preco_unitario numeric(14,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  codigo_externo text
);
CREATE INDEX IF NOT EXISTS ix_medicao_cliente_tabela ON public.erp_medicao_cliente (tabela_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_medicao_cliente_company ON public.erp_medicao_cliente (company_id);
CREATE INDEX IF NOT EXISTS ix_medicao_cliente_item_med ON public.erp_medicao_cliente_item (medicao_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_medicao_cliente','erp_medicao_cliente_item'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())', t || '_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_medicao_cliente_salvar(p_tabela uuid, p_dados jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid; v_med jsonb; v_id uuid; l jsonb; v_ok int := 0;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela AND ativo;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  IF btrim(coalesce(p_dados->>'descricao','')) = '' THEN RAISE EXCEPTION 'Informe a descrição da medição'; END IF;
  v_med := public.fn_tabela_preco_medir(p_tabela, coalesce(p_dados->'linhas','[]'));
  FOR l IN SELECT * FROM jsonb_array_elements(v_med->'linhas') LOOP
    IF (l->>'ok')::boolean THEN v_ok := v_ok + 1; END IF;
  END LOOP;
  IF v_ok = 0 THEN RAISE EXCEPTION 'Nenhuma linha da medição tem preço no contrato'; END IF;
  INSERT INTO erp_medicao_cliente (company_id, tabela_id, descricao, periodo_inicio, periodo_fim, total)
  VALUES (v_co, p_tabela, btrim(p_dados->>'descricao'), NULLIF(p_dados->>'periodo_inicio','')::date, NULLIF(p_dados->>'periodo_fim','')::date, (v_med->>'total')::numeric)
  RETURNING id INTO v_id;
  INSERT INTO erp_medicao_cliente_item (company_id, medicao_id, servico_ref, unidade, quantidade, condicao, faixa_de, faixa_ate, preco_unitario, total, codigo_externo)
  SELECT v_co, v_id, x->>'servico_ref', x->>'unidade', (x->>'quantidade')::numeric, coalesce(x->>'condicao','normal'),
         (x->>'faixa_de')::numeric, (x->>'faixa_ate')::numeric, (x->>'preco_unitario')::numeric, (x->>'total')::numeric, x->>'codigo_externo'
    FROM jsonb_array_elements(v_med->'linhas') x WHERE (x->>'ok')::boolean;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'total', (v_med->>'total')::numeric);
END $$;

CREATE OR REPLACE FUNCTION public.fn_medicao_cliente_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM erp_medicao_cliente WHERE id = p_id;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Medição não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  DELETE FROM erp_medicao_cliente WHERE id = p_id AND company_id = v_co;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.fn_medicao_cliente_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_medicao_cliente_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_medicao_cliente_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_medicao_cliente_excluir(uuid) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.medicao_descricao', 'Descrição da medição', 'Um nome que identifique a medição, como o mês ou o boletim.', 'Aparece na lista de medições salvas do contrato.', 'Medição outubro/2026 — Vista Verde', 'Deixar em branco: sem nome a medição não é salva.', 32),
 ('hub.tabela_preco.medicao_periodo', 'Período da medição', 'Data inicial e final do período medido (opcional).', 'Registra a que período se refere o valor cobrado do cliente.', '01/10/2026 a 31/10/2026', 'Misturar períodos diferentes na mesma medição.', 33),
 ('hub.tabela_preco.medicao_salvar', 'Salvar medição', 'Nada a preencher: grava a medição calculada com os preços do contrato.', 'Guarda o extrato; o total salvo é recalculado no servidor pela regra do contrato e sempre bate com ele.', 'Salvar a medição de outubro.', 'Alterar o contrato depois e esperar que a medição salva mude: ela guarda o preço da época.', 34),
 ('hub.tabela_preco.medicao_salvas', 'Medições salvas', 'Nada a preencher: lista as medições já gravadas deste contrato.', 'Consultar ou excluir uma medição anterior.', 'Medição outubro/2026 — R$ 28.350,00', 'Excluir uma medição já enviada ao cliente.', 35)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
