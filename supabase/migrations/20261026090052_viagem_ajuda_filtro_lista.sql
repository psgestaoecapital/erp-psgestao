-- Viagem · "?" (RD-95) do filtro da lista (obra, responsável, período) na tela /dashboard/projetos/viagens —
-- desenvolvedor_4_g (faixa 52). Insight do auditor #3611: "filtro por obra, responsável e período na listagem".
-- ADITIVA: só insere textos novos em erp_ajuda_campo (ON CONFLICT DO NOTHING); nada existente é alterado.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.filtro_obra', 'Filtro da lista', 'Obra', 'Escolha a obra para ver só as viagens abertas para ela. "Todas" mostra a lista inteira.', 'Só muda o que aparece na lista; não mexe em custo nem nos indicadores da obra.', 'DEMO-FC-001 · Pisos FC → só as viagens dessa obra', 'Procurar aqui uma viagem rateada: a lista usa a obra principal da viagem; o rateio por cupom aparece no relatório por obra.', 60),
  ('projetos.viagem.filtro_responsavel', 'Filtro da lista', 'Responsável', 'Digite parte do nome de quem fez a viagem.', 'Ajuda a achar o acerto de um colaborador sem rolar a lista toda.', '"joão" acha João Silva e João Pedro', 'Digitar o nome com erro de grafia: a lista fica vazia — toque em "Limpar filtro".', 61),
  ('projetos.viagem.filtro_periodo', 'Filtro da lista', 'Período (de / até)', 'Escolha a data inicial e/ou final. Aparece toda viagem que passou por algum dia desse intervalo.', 'Serve para conferir o acerto do mês ou da quinzena antes de fechar o caixa.', 'De 01/10 até 31/10 → viagens de outubro, inclusive a que saiu em 29/09 e voltou em 02/10', 'Pôr o "até" antes do "de": nenhuma viagem aparece.', 62)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
