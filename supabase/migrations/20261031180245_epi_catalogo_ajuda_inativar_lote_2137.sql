-- RD-95: "?" da ação "Inativar vários" do Catálogo de EPIs (/dashboard/compliance/epi/catalogo).
-- Nasce do chamado #2137 (Frioeste): a importação do ATAK trouxe todos os EPIs, inclusive os que
-- não estão mais em uso. A tela agora deixa marcar vários e inativar de uma vez (varredura), e esta
-- linha dá o texto de ajuda da ação. Aditivo: só texto em erp_ajuda_campo (sem tabela/RLS/dado de
-- cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Catálogo de EPIs', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/compliance/epi/catalogo', 'compliance', 'publicado'
FROM (VALUES
 ('epi.catalogo.inativar_lote', 'Inativar vários',
  'Entre em "Selecionar vários", marque os EPIs que não usa mais e clique em "Inativar selecionados".',
  'Faz a varredura do catálogo de uma vez: tira da lista de ativos os EPIs que não estão em uso (ex.: itens antigos trazidos de outro sistema), sem apagar nada.',
  'Após migrar o estoque e ver dezenas de EPIs que não usa, marque todos e inative em um clique, em vez de um a um.',
  'Inativar não apaga: o EPI sai da lista, mas o histórico fica. Para vê-lo de novo use "Mostrar inativos" e clique em "Reativar".',
  1)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
