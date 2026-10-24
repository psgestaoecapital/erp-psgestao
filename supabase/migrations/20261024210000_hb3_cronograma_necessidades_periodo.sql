-- HB3 (fatia 10) · Cronograma da obra: COMPRAS DO PERÍODO — quanto de cada insumo a obra vai consumir nas próximas
-- semanas, a partir do cronograma. Faltava o elo tarefa → item da obra (conferido 24/10: nenhuma tabela liga
-- projetos_obra_tarefa a projetos_obra_item). Cadeia do cálculo:
--   tarefa ─(NOVO projetos_obra_tarefa_item: participação %)→ item da obra (quantidade_contratada) → serviço →
--   composição projetos_servicos_bom (tipo 'insumo': quantidade por unidade do serviço, perda %).
--
-- FÓRMULA (por vínculo tarefa × item × insumo da composição; só tarefas com avanço < 100% e que começam até o fim do período):
--   restante   = quantidade_contratada × participação/100 × (1 − avanço/100)        (o que falta executar do item nesta tarefa)
--   ini        = maior(início da tarefa, início do período)
--   fração     = 1, se a tarefa já devia ter terminado (fim < início do período: tudo o que falta é para já);
--                senão (menor(fim, fim do período) − ini + 1) ÷ (fim − ini + 1)  (o que falta, espalhado por igual nos dias restantes)
--   quantidade = restante × fração × quantidade da composição × (1 + perda/100)
--   custo      = quantidade × custo unitário da composição (ou custo atual do insumo, se a composição não tiver)
-- Caso conhecido (gate + prova local): item 245 m², participação 100%, avanço 30%, tarefa 23/10–11/11, período
-- 24/10–06/11, composição 1,05 un/m² com perda 10% → restante 171,5; fração 14/19; quantidade 171,5×14/19×1,05×1,1 = 145,956.
--
-- Só objetos NOVOS (aditiva, RD-94.1 c):
-- 1) tabela projetos_obra_tarefa_item — RLS por empresa só de leitura, REVOKE anon, exclusão lógica (RD-30).
--    FKs com ON DELETE CASCADE: o fn_demo_reset/fn_demo_seed_construtora apaga tarefas e itens da demo fisicamente e
--    o vínculo não pode travar esse reset.
-- 2) fn_obra_tarefa_itens_salvar(tarefa, itens) — NOVA, guarda de empresa: troca o conjunto de itens da tarefa;
--    item tem que ser da mesma obra; a soma da participação do item em todas as tarefas não passa de 100%.
-- 3) fn_obra_necessidades_periodo(obra, de, ate) — NOVA, guarda de empresa, só leitura: a fórmula acima, agrupada por insumo.
-- 4) Vínculo inicial nas 4 obras da Construtora DEMO (b0700000-…-0006, is_demo) para o quadro ter dado; só se ainda não
--    houver vínculo. Some no próximo reset da demo — ligar no fn_demo_seed_construtora é fatia própria (via revisada).
-- 5) "?" (RD-95) do quadro, do período e do campo de itens da tarefa.
-- RD-55: nenhum dado de cliente é alterado. Plano de volta: DROP FUNCTION fn_obra_necessidades_periodo(uuid, date, date);
-- DROP FUNCTION fn_obra_tarefa_itens_salvar(uuid, jsonb); DROP TABLE projetos_obra_tarefa_item; DELETE das chaves
-- projetos.cronograma.compras*/itens_tarefa/participacao_item.
CREATE TABLE IF NOT EXISTS public.projetos_obra_tarefa_item (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tarefa_id        uuid NOT NULL REFERENCES public.projetos_obra_tarefa(id) ON DELETE CASCADE,
  obra_item_id     uuid NOT NULL REFERENCES public.projetos_obra_item(id) ON DELETE CASCADE,
  participacao_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (participacao_pct > 0 AND participacao_pct <= 100),
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  excluido_em      timestamptz
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

-- p_itens: [{"obra_item_id": "<uuid>", "participacao_pct": 50}, ...]; lista vazia tira todos os itens da tarefa.
CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_itens_salvar(p_tarefa_id uuid, p_itens jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_obra uuid; v_ids uuid[]; v_pcts numeric[]; v_estouro text;
BEGIN
  SELECT company_id, obra_id INTO v_company, v_obra FROM public.projetos_obra_tarefa WHERE id = p_tarefa_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF jsonb_typeof(COALESCE(p_itens, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Lista de itens inválida'; END IF;

  -- item repetido na lista: vale a última participação informada
  SELECT COALESCE(array_agg(x.id ORDER BY x.id), '{}'), COALESCE(array_agg(x.pct ORDER BY x.id), '{}') INTO v_ids, v_pcts
    FROM (SELECT DISTINCT ON ((e->>'obra_item_id')::uuid) (e->>'obra_item_id')::uuid AS id,
                 COALESCE(NULLIF(e->>'participacao_pct', '')::numeric, 100) AS pct
            FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) WITH ORDINALITY AS j(e, n)
           ORDER BY (e->>'obra_item_id')::uuid, n DESC) x;

  IF EXISTS (SELECT 1 FROM unnest(v_pcts) p WHERE p <= 0 OR p > 100) THEN
    RAISE EXCEPTION 'A participação deve ficar entre 1 e 100%%';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) x(id) LEFT JOIN public.projetos_obra_item i
               ON i.id = x.id AND i.obra_id = v_obra AND i.company_id = v_company AND i.excluido_em IS NULL
              WHERE i.id IS NULL) THEN
    RAISE EXCEPTION 'Item não é desta obra';
  END IF;
  -- a soma da participação do item em todas as tarefas não passa de 100%
  SELECT i.descricao INTO v_estouro
    FROM unnest(v_ids, v_pcts) x(id, pct) JOIN public.projetos_obra_item i ON i.id = x.id
   WHERE x.pct + COALESCE((SELECT sum(l.participacao_pct) FROM public.projetos_obra_tarefa_item l
                            JOIN public.projetos_obra_tarefa t ON t.id = l.tarefa_id AND t.excluido_em IS NULL
                           WHERE l.obra_item_id = x.id AND l.tarefa_id <> p_tarefa_id AND l.excluido_em IS NULL), 0) > 100
   LIMIT 1;
  IF v_estouro IS NOT NULL THEN
    RAISE EXCEPTION 'O item "%" passaria de 100%% somando as tarefas', v_estouro;
  END IF;

  UPDATE public.projetos_obra_tarefa_item l SET excluido_em = now()
   WHERE l.tarefa_id = p_tarefa_id AND l.excluido_em IS NULL AND NOT (l.obra_item_id = ANY (v_ids));
  UPDATE public.projetos_obra_tarefa_item l SET participacao_pct = x.pct
    FROM unnest(v_ids, v_pcts) x(id, pct)
   WHERE l.tarefa_id = p_tarefa_id AND l.obra_item_id = x.id AND l.excluido_em IS NULL;
  INSERT INTO public.projetos_obra_tarefa_item (company_id, tarefa_id, obra_item_id, participacao_pct, criado_por)
  SELECT v_company, p_tarefa_id, x.id, x.pct, auth.uid() FROM unnest(v_ids, v_pcts) x(id, pct)
   WHERE NOT EXISTS (SELECT 1 FROM public.projetos_obra_tarefa_item l
                      WHERE l.tarefa_id = p_tarefa_id AND l.obra_item_id = x.id AND l.excluido_em IS NULL);
  RETURN jsonb_build_object('ok', true, 'itens', cardinality(v_ids));
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_itens_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_itens_salvar(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_obra_necessidades_periodo(p_obra_id uuid, p_de date, p_ate date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid; v_insumos jsonb; v_vinc integer; v_sem integer;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido'; END IF;
  IF p_ate - p_de > 366 THEN RAISE EXCEPTION 'Período maior que um ano'; END IF;

  WITH vinc AS (
    SELECT t.nome AS tarefa, t.inicio, t.fim, i.servico_id,
           i.quantidade_contratada * l.participacao_pct / 100 * (1 - t.percentual / 100) AS restante,
           GREATEST(t.inicio, p_de) AS ini
      FROM public.projetos_obra_tarefa_item l
      JOIN public.projetos_obra_tarefa t ON t.id = l.tarefa_id AND t.excluido_em IS NULL
      JOIN public.projetos_obra_item i ON i.id = l.obra_item_id AND i.excluido_em IS NULL
     WHERE l.excluido_em IS NULL AND l.company_id = v_company AND t.obra_id = p_obra_id
       AND t.percentual < 100 AND t.inicio <= p_ate
  ), fr AS (
    SELECT v.*, CASE WHEN v.fim < p_de THEN 1::numeric
                     ELSE (LEAST(v.fim, p_ate) - v.ini + 1)::numeric / (v.fim - v.ini + 1) END AS fracao
      FROM vinc v
  ), linhas AS (
    SELECT b.insumo_id, ins.name AS nome, COALESCE(NULLIF(b.unidade, ''), ins.unit) AS unidade, f.tarefa,
           f.restante * f.fracao * b.quantidade * (1 + COALESCE(b.perda_pct, 0) / 100) AS qtd,
           COALESCE(b.custo_unitario, ins.current_cost, 0) AS custo_un
      FROM fr f
      JOIN public.projetos_servicos_bom b ON b.servico_id = f.servico_id AND b.tipo = 'insumo' AND b.insumo_id IS NOT NULL
      JOIN public.m16_insumos ins ON ins.id = b.insumo_id
  ), agr AS (
    SELECT insumo_id, nome, unidade, round(sum(qtd), 3) AS quantidade, round(sum(qtd * custo_un), 2) AS custo_estimado,
           array_agg(DISTINCT tarefa ORDER BY tarefa) AS tarefas
      FROM linhas GROUP BY insumo_id, nome, unidade
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('insumo_id', insumo_id, 'nome', nome, 'unidade', unidade,
                                               'quantidade', quantidade, 'custo_estimado', custo_estimado,
                                               'tarefas', to_jsonb(tarefas)) ORDER BY custo_estimado DESC, nome), '[]'::jsonb)
    INTO v_insumos FROM agr WHERE quantidade > 0;

  SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.projetos_servicos_bom b WHERE b.servico_id = i.servico_id AND b.tipo = 'insumo' AND b.insumo_id IS NOT NULL))
    INTO v_vinc, v_sem
    FROM public.projetos_obra_tarefa_item l
    JOIN public.projetos_obra_tarefa t ON t.id = l.tarefa_id AND t.excluido_em IS NULL
    JOIN public.projetos_obra_item i ON i.id = l.obra_item_id AND i.excluido_em IS NULL
   WHERE l.excluido_em IS NULL AND l.company_id = v_company AND t.obra_id = p_obra_id;

  RETURN jsonb_build_object('ok', true, 'de', p_de, 'ate', p_ate, 'insumos', v_insumos,
    'total_estimado', COALESCE((SELECT sum((x->>'custo_estimado')::numeric) FROM jsonb_array_elements(v_insumos) x), 0),
    'vinculos', v_vinc, 'vinculos_sem_composicao', v_sem);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_necessidades_periodo(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_necessidades_periodo(uuid, date, date) TO authenticated, service_role;

-- 4) vínculo inicial nas obras da Construtora DEMO (só is_demo, só se ainda não houver vínculo)
INSERT INTO public.projetos_obra_tarefa_item (company_id, tarefa_id, obra_item_id, participacao_pct)
SELECT t.company_id, t.id, i.id, m.pct
  FROM public.projetos_obra_tarefa t
  JOIN public.projetos_obra_item i ON i.obra_id = t.obra_id AND i.excluido_em IS NULL
  JOIN public.projetos_servicos s ON s.id = i.servico_id
  JOIN (VALUES ('Estrutura e perfis', 'DEMO-S01', 50::numeric), ('Fechamento e acabamento', 'DEMO-S01', 50),
               ('Estrutura e perfis', 'DEMO-S02', 50), ('Fechamento e acabamento', 'DEMO-S02', 50),
               ('Fechamento e acabamento', 'DEMO-S03', 100), ('Pintura e entrega', 'DEMO-S04', 100)) AS m(tarefa, servico, pct)
    ON m.tarefa = t.nome AND m.servico = s.codigo
 WHERE t.company_id = 'b0700000-0000-4000-a000-000000000006' AND t.excluido_em IS NULL
   AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = t.company_id AND c.is_demo IS TRUE)
   AND NOT EXISTS (SELECT 1 FROM public.projetos_obra_tarefa_item x WHERE x.company_id = t.company_id);

-- 5) "?" (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.compras', 'Compras do período', 'Nada a preencher: o quadro soma sozinho os insumos das tarefas do período, pelos itens ligados a cada tarefa e pela composição de cada serviço.', 'Mostra quanto de cada material a obra vai consumir até o fim do período, para comprar a tempo. Conta só o que falta executar: quantidade do item × participação da tarefa × (1 − avanço), espalhado pelos dias que faltam da tarefa, × consumo da composição × (1 + perda). Tarefa atrasada entra inteira.', 'Porcelanato: 245 m² na tarefa, 30% feito, 14 dos 19 dias restantes caem no período, 1,05 un/m² com 10% de perda → 145,956 un.', 'Tarefa sem itens ligados não gera compra: abra a tarefa em "Editar" e marque os itens que ela executa.', 32),
 ('projetos.cronograma.compras_custo', 'Custo estimado da compra', 'Nada a preencher: quantidade × custo unitário da composição do serviço (ou o custo atual do insumo, quando a composição não traz).', 'Dá a ordem de grandeza do dinheiro que sai no período, para combinar com o financeiro antes de pedir ao fornecedor.', '145,956 un × R$ 62,00 ≈ R$ 9.049.', 'Composição com custo desatualizado: confira o custo do insumo no cadastro antes de fechar o pedido.', 33),
 ('projetos.cronograma.itens_tarefa', 'Itens executados nesta tarefa', 'Marque os itens do contrato que esta tarefa executa e quanto do item ela faz (participação, de 1 a 100%).', 'Liga o cronograma ao orçamento: é por esse elo que o quadro "Compras do período" sabe quais materiais pedir e quando. A soma da participação de um item em todas as tarefas não passa de 100%.', 'Parede drywall: 50% em "Estrutura e perfis" e 50% em "Fechamento e acabamento".', 'Marcar o mesmo item com 100% em duas tarefas: o sistema recusa, porque o material seria pedido em dobro.', 34),
 ('projetos.cronograma.participacao_item', 'Participação do item na tarefa (%)', 'Quanto do item esta tarefa executa, de 1 a 100%. Ao marcar o item, já vem o que ainda está livre.', 'Divide a quantidade do item entre as tarefas: o quadro "Compras do período" pede só a parte desta tarefa, e só o que falta executar dela.', '190 m² de drywall com 50% aqui: a tarefa responde por 95 m².', 'Somar mais de 100% entre as tarefas: o sistema recusa, e o "livre" mostra quanto ainda cabe.', 35)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
