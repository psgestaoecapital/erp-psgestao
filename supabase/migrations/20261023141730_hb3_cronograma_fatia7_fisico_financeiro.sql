-- HB3 (fatia 7) · Cronograma da obra: custo previsto por tarefa (físico-financeiro) e "?" dos novos campos (RD-95).
-- Aditiva: coluna nova (nula = sem custo), função nova com guarda de empresa; nenhuma função existente é alterada.
ALTER TABLE public.projetos_obra_tarefa
  ADD COLUMN IF NOT EXISTS custo_previsto numeric(14,2) CHECK (custo_previsto IS NULL OR custo_previsto >= 0);

CREATE OR REPLACE FUNCTION public.fn_obra_tarefa_custo_salvar(p_id uuid, p_custo numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obra_tarefa WHERE id = p_id AND excluido_em IS NULL;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF p_custo IS NOT NULL AND p_custo < 0 THEN RAISE EXCEPTION 'O custo previsto não pode ser negativo'; END IF;
  UPDATE public.projetos_obra_tarefa SET custo_previsto = p_custo
   WHERE id = p_id AND company_id = v_company AND excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.fn_obra_tarefa_custo_salvar(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_tarefa_custo_salvar(uuid, numeric) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Cronograma da obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/[id]/cronograma', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.cronograma.custo_previsto', 'Custo previsto (R$)', 'O quanto você espera gastar nesta tarefa, em reais. Pode deixar em branco.', 'Alimenta o físico-financeiro: o custo da tarefa é distribuído ao longo do prazo e apropriado conforme o avanço.', 'Alvenaria: R$ 18.000,00.', 'Lançar o preço de venda em vez do custo da tarefa.', 26),
 ('projetos.cronograma.ind_custo_previsto', 'Custo previsto total', 'Nada a preencher: soma do custo previsto das tarefas.', 'Orçamento de custo da obra segundo o cronograma.', 'R$ 250.000,00 em 12 tarefas com custo.', 'Esquecer de informar o custo em alguma tarefa: o total fica menor que o real.', 27),
 ('projetos.cronograma.ind_custo_apropriado', 'Custo apropriado', 'Nada a preencher: custo previsto de cada tarefa multiplicado pelo avanço dela.', 'Quanto do custo previsto já foi "consumido" pelo trabalho feito.', 'R$ 80.000,00 apropriados de R$ 250.000,00.', 'Confundir com o gasto pago: é o valor do trabalho feito, não o que saiu do caixa.', 28),
 ('projetos.cronograma.ind_custo_planejado', 'Custo planejado hoje', 'Nada a preencher: custo que deveria estar apropriado hoje pelo prazo.', 'Comparado ao apropriado, mostra se o físico-financeiro está atrasado ou adiantado.', 'R$ 100.000,00 planejados para hoje.', 'Comparar com o valor pago em vez do apropriado.', 29)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
