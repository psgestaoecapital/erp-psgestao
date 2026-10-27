-- Hub · Simulador: salvar, listar e excluir (soft-delete) simulações (caixa 875dce9c, dev7claudeps).
-- SÓ ADITIVO: tabela nova (RLS por company_id, sem policy permissiva, REVOKE anon) + 3 funções novas
-- + linhas novas em erp_ajuda_campo. O resultado salvo é recalculado no servidor (não confia em valor da tela).

CREATE TABLE IF NOT EXISTS public.projetos_simulacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  servico_id uuid NOT NULL,
  business_line_id uuid,
  nome text NOT NULL,
  montagem text,
  unidade text,
  area numeric NOT NULL CHECK (area > 0),
  total_m2 numeric,
  total_obra numeric,
  resultado jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS projetos_simulacao_company_idx
  ON public.projetos_simulacao (company_id, created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.projetos_simulacao ENABLE ROW LEVEL SECURITY;

-- leitura só da própria empresa; escrita só pelas funções abaixo (SECURITY DEFINER)
DROP POLICY IF EXISTS projetos_simulacao_sel ON public.projetos_simulacao;
CREATE POLICY projetos_simulacao_sel ON public.projetos_simulacao
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.projetos_simulacao FROM PUBLIC, anon;
GRANT SELECT ON public.projetos_simulacao TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_simulacao_salvar(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid, p_area numeric, p_nome text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sim jsonb; v_id uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_login'); END IF;
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(p_area, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'metragem_invalida'); END IF;
  v_sim := fn_simular_montagem(p_servico_id, p_company_id, p_business_line_id, p_area);
  IF NOT COALESCE((v_sim->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_sim->>'erro', 'falha_simulacao'));
  END IF;
  v_nome := COALESCE(NULLIF(btrim(p_nome), ''), COALESCE(v_sim->>'montagem', 'Simulação') || ' · ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'));
  INSERT INTO projetos_simulacao (company_id, servico_id, business_line_id, nome, montagem, unidade, area,
    total_m2, total_obra, resultado)
  VALUES (p_company_id, p_servico_id, p_business_line_id, left(v_nome, 120), v_sim->>'montagem', v_sim->>'unidade', p_area,
    (v_sim->'preco_m2'->>'total_m2')::numeric, (v_sim->>'total_obra')::numeric, v_sim)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.fn_simulacao_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_login'); END IF;
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'itens', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'montagem', s.montagem, 'unidade', s.unidade,
      'area', s.area, 'total_m2', s.total_m2, 'total_obra', s.total_obra, 'servico_id', s.servico_id,
      'business_line_id', s.business_line_id, 'created_at', s.created_at) ORDER BY s.created_at DESC)
    FROM (SELECT * FROM projetos_simulacao WHERE company_id = p_company_id AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 50) s), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.fn_simulacao_excluir(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_login'); END IF;
  SELECT company_id INTO v_company FROM projetos_simulacao WHERE id = p_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrada'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE projetos_simulacao SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.fn_simulacao_salvar(uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_simulacao_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_simulacao_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_salvar(uuid, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_excluir(uuid) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Simulador', v.rotulo, v.o_que, v.serve, v.ex, v.erro, v.ordem, '/dashboard/projetos/simulador', 'projetos', 'publicado'
FROM (VALUES
 ('projetos.simulador.nome_simulacao','Nome da simulação','Opcional. Dê um nome para achar esta simulação depois; sem nome, usamos a montagem e a data.','Identifica a simulação na lista de salvas.','Apartamento 302 · piso vinílico','Salvar várias simulações com o mesmo nome: a lista fica difícil de distinguir.',80),
 ('projetos.simulador.salvar','Salvar simulação','Clique para guardar esta montagem, metragem e resultado na lista de simulações da empresa.','Permite voltar depois e comparar cenários sem refazer a conta. O valor é recalculado no servidor ao salvar.','Salvar 100 m² de drywall como "Loja centro".','Achar que salvar gera orçamento: salvar só guarda a simulação; use "Gerar orçamento" para o orçamento.',90),
 ('projetos.simulador.salvas','Simulações salvas','Não se preenche: lista as últimas simulações salvas da empresa.','Reabrir um cenário (botão Abrir) ou removê-lo da lista (Excluir).','Loja centro · 100 m² · R$ 12.300,00','Esperar que Excluir apague para sempre: a simulação sai da lista, mas fica registrada com data e autor.',100),
 ('projetos.simulador.abrir','Abrir simulação salva','Clique para carregar a montagem e a metragem da simulação salva no formulário.','Recalcula com os preços de hoje a partir do mesmo cenário.','Abrir "Loja centro".','Esperar o mesmo valor de antes: a conta é refeita com os preços atuais.',110),
 ('projetos.simulador.excluir','Excluir simulação','Clique para tirar a simulação da lista de salvas.','Mantém a lista limpa; o registro fica guardado com data e autor da exclusão.','Excluir "Teste".','Excluir a simulação errada: não há desfazer na tela; refaça e salve de novo.',120)
) AS v(chave, rotulo, o_que, serve, ex, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
