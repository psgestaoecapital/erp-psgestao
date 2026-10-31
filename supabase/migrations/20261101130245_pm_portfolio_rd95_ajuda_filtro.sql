-- RD-95 (CEO 08/10): "?" no único filtro da tela Portfolio (P&M) · /dashboard/pm/portfolio.
-- O auditor PDCA (auditor_pdca_2) pediu RD-95 "?" em todo campo/filtro/indicador. A galeria só tem
-- um filtro ("Todos os clientes") e ele estava sem ajuda. Texto explica o recorte sem mexer no dado.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/portfolio', 'pm', 'publicado'
FROM (VALUES
 ('pm.portfolio.filtro_cliente', 'Portfolio', 'Filtrar por cliente',
  'Filtro de leitura: escolha um cliente para ver só as entregas publicadas dele, ou "Todos os clientes" para a galeria completa.',
  'Ajuda a montar um portfólio por cliente — útil para apresentar o que já foi entregue a cada um.',
  'Selecionar "Studio Alfa" mostra só os jobs publicados desse cliente.',
  'Estranhar a galeria vazia com um cliente escolhido: ela só traz jobs já publicados/concluídos; clientes sem entrega publicada não aparecem.',
  1)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
