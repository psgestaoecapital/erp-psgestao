-- Reconciliação de baseline (RD-38) da tela §315 "Orçamento por EAP", após a Onda C-2:
--   incluir/editar/excluir item (fn_projetos_orcamento_item_eap_salvar/_listar/_excluir, todas em
--   produção) + árvore (fn_projetos_orcamento_eap_arvore) + importador .xlsx (§334, PR #5812).
-- Marca SÓ o provado no código/RPCs vivas; campos ainda ausentes ficam citados na evidência.
-- Data-only, aditiva, idempotente (UPDATE por id).

-- (atendido) Importar a planilha (.xlsx) mantendo códigos, unidades e valores; mostrar o não lido;
--   aguentar 10 mil itens. #5812 + fn_..._importar: código é texto (preserva 23,10), unidade e
--   valores material/MO/qtd preservados; prévia mostra válidos × com erro + motivos; limite de
--   10.000 linhas imposto na RPC.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='PR #5812 · /dashboard/projetos/obras/[id]/orcamento/importar — fn_projetos_orcamento_eap_importar: preserva código (texto), unidade e valores; prévia (validar) mostra o não lido com motivos; limite de 10.000 linhas na RPC.'
 WHERE id='d447fd93-3a24-4c7f-80bd-d3a42982ed27';

-- (parcial) Dados de cada item. salvar/listar/excluir + complemento EAP entregam: código EAP, vínculo
--   ao catálogo (servico_id) e ao padrão (ref_padrao_codigo), local (tipo/nome), quantidade, custo de
--   material e de mão de obra SEPARADOS, subtotal. Faltam: índice, custo de equipamento, verba,
--   observação e código original da planilha.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='PR #5818/#5828 · tela orcamento — fn_..._item_eap_salvar/_listar/_excluir + complemento projetos_orcamento_item_eap: código EAP, vínculo catálogo+padrão, local (tipo/nome), qtd, material e mão de obra SEPARADOS, subtotal. Faltam: índice, equipamento, verba, observação, código original.'
 WHERE id='3c0ed92c-5355-4da2-ab68-6179a44c5b62';

-- (parcial) Três jeitos de começar. Entregue o jeito (2) importar planilha (334, #5812); o "+ Item"
--   permite escolher serviço do catálogo. Faltam (1) partir da EAP padrão PS guiado e (3) copiar o
--   orçamento de outra obra.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='PR #5812 (importar 334) + "+ Item" (escolhe serviço do catálogo). Faltam: (1) partir da EAP padrão PS guiado e (3) copiar orçamento de outra obra.'
 WHERE id='bc10f157-1a69-4894-8877-f653e28e0052';

-- (parcial) Tela do orçamento em EAP. A rota renderiza a árvore EAP (etapa/subetapa) com material × mão
--   de obra separados, % por nó e totais (fn_..._arvore, #5798), e incluir/editar/excluir (#5818+#5828).
--   Parcial: profundidade plena de 6 níveis, índice e demais campos ainda não cobertos.
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='PR #5798/#5818/#5828 · tela orcamento — árvore EAP (etapa/subetapa), material×mão de obra separados, % por nó e totais; incluir/editar/excluir item. Parcial: profundidade de 6 níveis, índice e demais campos.'
 WHERE id='be2833ca-0d99-4fd2-b436-56d6e28cd4ed';
