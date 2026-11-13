-- Indústria · Visão Quadro — slice 2b: ajuda RD-95 "?" dos dois filtros novos (Centro de custo, Supervisor).
-- ADITIVO e idempotente: só linhas novas de ajuda. Nenhuma função/view/policy é alterada.
INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('industria.quadro.filtro_centro_custo', '/dashboard/produtividade', 'Filtrar por centro de custo',
  'Escolha um centro de custo para ver só os postos ligados a ele.',
  'Reduz a grade do quadro a um centro de custo; os totais e subtotais acompanham o filtro. O centro de custo vem do cadastro do posto.',
  'Centro de custo: CC-ABATE.',
  'Posto sem centro de custo aparece em "Sem centro de custo" — informe o centro no cadastro do posto para rateio correto.'),
 ('industria.quadro.filtro_supervisor', '/dashboard/produtividade', 'Filtrar por supervisor',
  'Escolha um supervisor para ver só os postos sob a responsabilidade dele.',
  'Reduz a grade do quadro aos postos de um supervisor; útil para conferir quadro × vagas por responsável.',
  'Supervisor: Carlos Meneghel.',
  'Posto sem supervisor aparece em "Sem supervisor" — informe o responsável no cadastro do posto.')
ON CONFLICT (chave) DO NOTHING;
