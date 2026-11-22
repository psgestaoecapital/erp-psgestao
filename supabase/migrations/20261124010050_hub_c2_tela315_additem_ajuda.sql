-- Hub · Onda C-2 · tela 315 (Orçamento por EAP) — slice 2 "+ Item" (escrita).
-- RD-95: cada campo do formulário "+ Item" tem o "?" (AjudaCampo). Esta migration só semeia as chaves de ajuda
-- dos novos campos; é aditiva e idempotente (ON CONFLICT). A escrita em si usa a RPC já publicada
-- fn_projetos_orcamento_item_eap_salvar. Não toca tabela de domínio nem dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.orcamento_eap.item_servico','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Serviço','Escolha o serviço do catálogo da empresa que será lançado no orçamento.','É a base do item: dele vêm a unidade, a EAP e os custos de material e mão de obra (que você pode ajustar).','Concreto fck 40MPa usinado para vigas e lajes','Lançar um texto livre — o item precisa de um serviço do catálogo para herdar custo e EAP.','projetos',110,'publicado'),
 ('projetos.orcamento_eap.item_quantidade','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Quantidade','A quantidade do serviço na unidade dele (m², m³, un, etc.).','Multiplica o custo unitário para dar o subtotal do item no orçamento.','120 (m³ de concreto)','Deixar zero ou negativo — a quantidade precisa ser maior que zero.','projetos',120,'publicado'),
 ('projetos.orcamento_eap.item_custo_material','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Custo material (unit.)','O custo de material por unidade. Vem preenchido do serviço e pode ser ajustado para esta obra.','Separa o material da mão de obra no orçamento, para compra e para comparar com o realizado.','R$ 874,75','Somar material e mão de obra no mesmo campo — cada um tem o seu.','projetos',130,'publicado'),
 ('projetos.orcamento_eap.item_custo_mao_obra','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Custo mão de obra (unit.)','O custo de mão de obra por unidade. Vem preenchido do serviço e pode ser ajustado para esta obra.','Separa a mão de obra do material no orçamento, para medição e para comparar com o apropriado.','R$ 75,00','Lançar o salário por hora aqui — este é o custo orçado do serviço, não o ponto.','projetos',140,'publicado'),
 ('projetos.orcamento_eap.item_local_tipo','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Local','Onde na obra o serviço acontece (pavimento, unidade, fachada, zona, ambiente ou equipamento). Opcional.','Permite ver o orçamento pivotado por local, além da árvore de etapas (EAP).','Pavimento','Achar que o local muda a etapa (EAP) — são dimensões diferentes do mesmo item.','projetos',150,'publicado'),
 ('projetos.orcamento_eap.item_local_nome','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Nome do local','O nome do local específico, se houver (ex.: Térreo, Bloco A, Unidade 101). Opcional.','Detalha o local escolhido para você somar o custo por onde o serviço é executado.','Térreo','Repetir o tipo do local no nome — o tipo já é escolhido ao lado.','projetos',160,'publicado'),
 ('projetos.orcamento_eap.item_eap','/dashboard/projetos/obras/[id]/orcamento','Orçamento por EAP','Código EAP','O código da etapa na EAP. Vem do serviço; preencha só se quiser lançar numa etapa diferente.','Define em que etapa da árvore o item entra. Em texto, preservando o zero à esquerda (23.10 ≠ 23.1).','08.03','Digitar número que perca o zero (23,1 em vez de 23.10) — o código é texto.','projetos',170,'publicado')
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
