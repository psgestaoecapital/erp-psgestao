-- Hub · Onda C-2 · tela 315 (Orçamento por EAP) — ajuda RD-95 da UI editar/excluir + clareza da fatia EAP.
-- Fatia de UI (page.tsx) que consome o backend já aberto no PR #5814
-- (fn_projetos_orcamento_item_eap_listar / _excluir) e o _salvar(..., p_item_id) já publicado.
-- Esta migration é SÓ DADO (erp_ajuda_campo): não cria/altera função, tabela ou RLS. Aditiva e idempotente.
--  1) Chave "Itens do orçamento" (bloco com editar/excluir) — RD-98 p2.
--  2) Corrige o texto do "Total estruturado (EAP)": é a soma dos itens estruturados pela EAP, não o total
--     cheio do orçamento quando ainda há itens sem EAP (gap 2 do PDCA d635c805).
-- Code: desenvolvedor_4_g

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.orcamento_eap.itens','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Itens do orçamento','A lista de cada serviço lançado no orçamento, com EAP, local, quantidade e subtotal.','Permite corrigir (editar) ou remover (excluir) um item lançado com erro, sem refazer o orçamento. A árvore e os totais se ajustam.','Clique em Editar para ajustar quantidade/custo; Excluir remove o item do orçamento.','Excluir um item achando que só sai da visão — ele é removido do orçamento (com rastro) e o total cai.','projetos',50,'publicado'),
 ('projetos.orcamento_eap.total','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Total estruturado (EAP)','A soma dos itens já estruturados pela EAP (material + mão de obra).','Mostra o valor da obra organizado pela EAP. Se o orçamento tiver itens sem EAP, eles não entram aqui — o aviso informa quanto falta estruturar.','R$ 237.437,50 estruturados de um orçamento de R$ 690.902,50','Ler o total da EAP como total cheio da obra quando ainda há itens sem EAP.','projetos',10,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  status          = 'publicado',
  atualizado_em   = now();
