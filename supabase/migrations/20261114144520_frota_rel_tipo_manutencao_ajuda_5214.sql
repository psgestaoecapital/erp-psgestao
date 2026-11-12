-- Chamado #5214 (frota/logística) · Relatórios de frota — filtro "Tipo de manutenção" no relatório de Manutenção.
-- Esta migration é ADITIVA e idempotente: cadastra apenas a chave de ajuda RD-95 do novo filtro
-- "Tipo de manutenção" (recorte da tela, sem nova chamada ao banco). Nenhuma função, RLS, tabela ou dado
-- de cliente é tocado — só uma linha do catálogo de ajuda (erp_ajuda_campo).
--
-- Code: jordana-code

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'projetos.frota.rel_tipo_manutencao',
  '/dashboard/projetos/frota',
  'Relatórios',
  'Tipo de manutenção',
  'Escolha um tipo de manutenção para ver só ele (preventiva, troca de óleo, pneus, revisão…), ou deixe em "Todos" para ver tudo. A lista mostra os tipos que aparecem no período.',
  'Deixa a logística acompanhar um tipo de manutenção de cada vez — por exemplo, só as trocas de óleo — nas manutenções realizadas e nas programadas. O total, o gráfico e a exportação CSV passam a considerar só o tipo escolhido.',
  'Selecionar "Troca de óleo" → a tabela, o total em R$ e o gráfico mostram apenas as trocas de óleo do período, e as programadas desse tipo.',
  'Com um tipo selecionado, o total deixa de somar a frota inteira e passa a somar só aquele tipo — volte para "Todos" para ver o total geral.',
  'hub',
  968,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
