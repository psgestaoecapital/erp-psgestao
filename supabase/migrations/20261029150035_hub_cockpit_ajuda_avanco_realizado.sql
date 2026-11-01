-- Hub · Cockpit da obra: corrige o texto do "?" (RD-95) do "Avanço financeiro" para bater com o cálculo da tela.
-- Problema (provado no banco 28/10): as 5 obras DEMO da construtora (…0006) têm receita_servico = 0 (a demo não emite
-- NFS-e de medição — trg_bloqueia_emissao_demo), e a receita entra por erp_pedidos → receita_material
-- (seed 20261029120047, pedido = receita_prevista × pct_conclusao/100). A tela calculava avanço = receita_servico/previsto,
-- logo mostrava 0% em obra 56%/100% concluída, contradizendo o card "Receita realizada" (serviço + material).
-- Correção (PR do front na mesma entrega): avanço = receita realizada total (serviço medido + material vendido) / prevista.
-- Aqui só alinhamos o texto de ajuda ao novo cálculo. Aditiva: só atualiza texto de ajuda existente; sem dado de cliente, sem RLS.
-- Idempotente: UPDATE por chave; reexecutar não duplica nem muda mais nada.
UPDATE public.erp_ajuda_campo
   SET o_que_preencher = 'Nada a preencher: é a receita já realizada (serviço medido + material vendido à obra) dividida pela receita prevista dos itens contratados.',
       para_que_serve  = 'Indica quanto da obra já virou receita frente ao contratado — soma a medição de serviço e a venda de material ligada à obra.',
       exemplo         = 'Realizado R$ 56.000 de R$ 100.000 = 56%',
       erro_comum      = 'Esperar só a medição de serviço: quando a receita vem por venda de material à obra, ela também conta no avanço.'
 WHERE chave = 'projetos.cockpit.avanco';
