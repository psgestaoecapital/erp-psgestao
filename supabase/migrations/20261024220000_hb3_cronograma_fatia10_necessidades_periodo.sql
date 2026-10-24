-- HB3 (fatia 10) · Cronograma da obra: o que comprar para as tarefas do período.
-- Liga tarefa do cronograma -> item contratado da obra (projetos_obra_item) e, pela composição do serviço
-- (projetos_servicos_bom, insumos), soma o material que falta para terminar as tarefas do período.
-- Só objetos NOVOS. RLS por empresa, REVOKE anon, gravação só pelas funções com guarda de empresa, exclusão lógica (RD-30).
CREATE TABLE IF NOT EXISTS public.projetos_obra_tarefa_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tarefa_id      uuid NOT NULL REFERENCES public.projetos_obra_tarefa(id),
  obra_item_id   uuid NOT NULL REFERENCES public.projetos_obra_item(id),
  percentual     numeric(5,2) NOT NULL DEFAULT 100 CHECK (percentual > 0 AND percentual <= 100),
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz,
  excluido_por   uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS projetos_obra_tarefa_item_uq
  ON public.projetos_obra_tarefa_item (tarefa_id, obra_item_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS projetos_obra_tarefa_item_item_idx
  ON public.projetos_obra_tarefa_item (obra_item_id) WHERE excluido_em IS NULL;

ALTER TABLE public.projetos_obra_tarefa_item ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_obra_tarefa_item FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_obra_tarefa_item_ler ON public.projetos_obra_tarefa_item;
CREATE POLICY projetos_obra_tarefa_item_ler ON public.projetos_obra_tarefa_item FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_obra_tarefa_item TO authenticated;

-- vincula (ou ajusta a parte de) um item da obra a uma tarefa da MESMA obra
CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_item_salvar(p_tarefa_id uuid, p_obra_item_id uuid, p_percentual numeric DEFAULT 100)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_obra uuid; v_id uuid;
BEGIN
  SELECT company_id, obra_id INTO v_company, v_obra FROM public.projetos_obra_tarefa WHERE id = p_tarefa_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF NOT EXISTS (SELECT 1 FROM public.projetos_obra_item
                  WHERE id = p_obra_item_id AND obra_id = v_obra AND company_id = v_company AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'Item da obra não encontrado';
  END IF;
  IF COALESCE(p_percentual, 100) <= 0 OR COALESCE(p_percentual, 100) > 100 THEN RAISE EXCEPTION 'A parte do item deve ficar entre 1 e 100'; END IF;
  INSERT INTO public.projetos_obra_tarefa_item (company_id, tarefa_id, obra_item_id, percentual, criado_por)
  VALUES (v_company, p_tarefa_id, p_obra_item_id, COALESCE(p_percentual, 100), auth.uid())
  ON CONFLICT (tarefa_id, obra_item_id) WHERE excluido_em IS NULL
  DO UPDATE SET percentual = EXCLUDED.percentual
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_item_salvar(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_item_salvar(uuid, uuid, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_item_excluir(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_tarefa_item WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Vínculo não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.projetos_obra_tarefa_item SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_item_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_item_excluir(uuid) TO authenticated, service_role;

-- Material que falta para terminar as tarefas do período [p_de, p_ate] (e as atrasadas, que já deviam ter terminado).
-- Por insumo: quantidade contratada do item × parte do item na tarefa × consumo da composição × (1 + perda)
-- × o que falta da tarefa (1 − avanço). Só leitura.
CREATE OR REPLACE FUNCTION public.fn_obra_necessidades_periodo(p_obra_id uuid, p_de date, p_ate date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_insumos jsonb; v_sem_vinculo int; v_sem_composicao int;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido'; END IF;

  WITH tar AS (
    SELECT t.id, t.nome, t.inicio, t.percentual FROM public.projetos_obra_tarefa t
     WHERE t.obra_id = p_obra_id AND t.company_id = v_company AND t.excluido_em IS NULL AND t.percentual < 100
       AND t.inicio <= p_ate  -- começa até o fim do período; as atrasadas (fim antes de p_de) também entram
  ), lin AS (
    SELECT b.insumo_id, tar.nome AS tarefa, GREATEST(tar.inicio, p_de) AS quando,
           oi.quantidade_contratada * ti.percentual / 100.0 * b.quantidade * (1 + COALESCE(b.perda_pct, 0) / 100.0)
             * (1 - tar.percentual / 100.0) AS qtd
      FROM tar
      JOIN public.projetos_obra_tarefa_item ti ON ti.tarefa_id = tar.id AND ti.excluido_em IS NULL
      JOIN public.projetos_obra_item oi ON oi.id = ti.obra_item_id AND oi.excluido_em IS NULL
      JOIN public.projetos_servicos_bom b ON b.servico_id = oi.servico_id AND b.tipo = 'insumo' AND b.insumo_id IS NOT NULL
  ), agg AS (
    SELECT l.insumo_id, SUM(l.qtd) AS qtd, MIN(l.quando) AS quando, array_agg(DISTINCT l.tarefa ORDER BY l.tarefa) AS tarefas
      FROM lin l GROUP BY l.insumo_id HAVING SUM(l.qtd) > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'insumo_id', a.insumo_id, 'insumo', COALESCE(m.name, 'Insumo sem nome'), 'unidade', m.unit,
           'quantidade', round(a.qtd, 4), 'custo_unitario', m.current_cost,
           'custo_estimado', CASE WHEN m.current_cost IS NULL THEN NULL ELSE round(a.qtd * m.current_cost, 2) END,
           'a_partir_de', a.quando, 'tarefas', to_jsonb(a.tarefas))
         ORDER BY a.quando, m.name), '[]'::jsonb)
    INTO v_insumos
    FROM agg a LEFT JOIN public.m16_insumos m ON m.id = a.insumo_id;

  -- tarefas do período sem item ligado (não entram na conta) e itens ligados cujo serviço não tem composição de insumo
  SELECT count(*) INTO v_sem_vinculo FROM public.projetos_obra_tarefa t
   WHERE t.obra_id = p_obra_id AND t.company_id = v_company AND t.excluido_em IS NULL AND t.percentual < 100 AND t.inicio <= p_ate
     AND NOT EXISTS (SELECT 1 FROM public.projetos_obra_tarefa_item ti WHERE ti.tarefa_id = t.id AND ti.excluido_em IS NULL);
  SELECT count(DISTINCT oi.id) INTO v_sem_composicao
    FROM public.projetos_obra_tarefa t
    JOIN public.projetos_obra_tarefa_item ti ON ti.tarefa_id = t.id AND ti.excluido_em IS NULL
    JOIN public.projetos_obra_item oi ON oi.id = ti.obra_item_id AND oi.excluido_em IS NULL
   WHERE t.obra_id = p_obra_id AND t.company_id = v_company AND t.excluido_em IS NULL AND t.percentual < 100 AND t.inicio <= p_ate
     AND NOT EXISTS (SELECT 1 FROM public.projetos_servicos_bom b WHERE b.servico_id = oi.servico_id AND b.tipo = 'insumo' AND b.insumo_id IS NOT NULL);

  RETURN jsonb_build_object('ok', true, 'de', p_de, 'ate', p_ate, 'insumos', v_insumos,
    'custo_total', (SELECT round(COALESCE(SUM((e->>'custo_estimado')::numeric), 0), 2) FROM jsonb_array_elements(v_insumos) e),
    'tarefas_sem_item', v_sem_vinculo, 'itens_sem_composicao', v_sem_composicao);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_necessidades_periodo(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_necessidades_periodo(uuid, date, date) TO authenticated, service_role;

-- "?" do quadro e do vínculo (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.necessidades', 'O que comprar no período', 'Nada a preencher: o quadro soma sozinho o material das tarefas do período, a partir dos itens da obra ligados a cada tarefa.', 'Mostra quanto de cada insumo falta para terminar as tarefas que acontecem no período escolhido (e as atrasadas), com o custo estimado pelo último custo do insumo. Use para fazer o pedido de compra a tempo, sem faltar nem sobrar material.', 'Cimento CP-II: 42 sacos a partir de 28/10, para Alvenaria do 2º pavimento. Custo estimado R$ 1.512,00.', 'Não ligar os itens da obra às tarefas: tarefa sem item ligado não entra na conta e o quadro avisa quantas estão assim.', 32),
 ('projetos.cronograma.itens_tarefa', 'Itens da obra nesta tarefa', 'Marque os itens do contrato que a equipe executa nesta tarefa. Um item dividido em várias tarefas pode ser ligado a cada uma delas.', 'É o que liga o cronograma ao material: pela composição do serviço de cada item, o quadro "O que comprar no período" calcula o insumo que a tarefa consome.', 'Tarefa "Alvenaria do térreo" ligada ao item "Alvenaria de blocos cerâmicos".', 'Ligar o mesmo item inteiro a duas tarefas: o material dele é contado duas vezes. Ligue a parte de cada tarefa.', 33),
 ('projetos.cronograma.itens_tarefa_parte', 'Parte do item (%)', 'Quanto do item contratado esta tarefa executa, de 1 a 100. Padrão: 100 (o item inteiro).', 'Divide a quantidade contratada do item entre as tarefas que o executam, para o material não ser contado em dobro.', 'Alvenaria de 400 m² feita metade no térreo e metade no 2º pavimento: 50% em cada tarefa.', 'Deixar 100% em todas as tarefas que dividem o mesmo item.', 34)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
