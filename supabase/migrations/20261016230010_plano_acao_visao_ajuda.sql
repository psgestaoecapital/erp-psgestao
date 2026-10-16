-- #3177 (Frioeste) · Plano de Ação: cartões arrastáveis no quadro + visão em tabela.
-- ADITIVA: só o texto do "?" (RD-95) do seletor de visão. Sem tabela, função ou dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Plano de Ação 5W2H', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/industrial/plano-acao', 'industrial', 'publicado'
FROM (VALUES
 ('industrial.plano_acao.visao', 'Visão: Quadro ou Tabela',
  'Escolha como ver as ações: Quadro (colunas por status) ou Tabela (uma linha por ação).',
  'No Quadro, arraste o cartão para outra coluna para mudar o status (soltar em "Concluída" pede o resultado obtido). Na Tabela, veja todas as ações lado a lado e clique na linha para editar. Os filtros valem nas duas visões.',
  'Arrastar a ação PA-0012 de "Aberta" para "Em andamento".',
  'Soltar o cartão fora de uma coluna não muda nada; no celular, segure o cartão por um instante antes de arrastar.', 20)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
