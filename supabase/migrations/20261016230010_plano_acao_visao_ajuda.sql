-- #3177 / #3181 (Frioeste) · Plano de Ação: alternar Quadro/Tabela e arrastar cartão entre colunas.
-- ADITIVA: só o texto do "?" (RD-95) do seletor de visão. Sem tabela, função ou dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Plano de Ação 5W2H', 'Forma de exibir', v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'industrial', 'publicado'
FROM (VALUES
 ('industrial.plano_acao.visao', '/dashboard/industrial/plano-acao',
  'Escolha "Quadro" (colunas por status) ou "Tabela" (uma linha por ação).',
  'No Quadro, arraste o cartão para outra coluna para mudar o status (ao soltar em Concluída, o sistema pede o resultado). Na Tabela, mude o status pela lista da linha. Os filtros valem nas duas formas.',
  'Reunião: Tabela para ler todas as ações; dia a dia: Quadro para mover os cartões.',
  'Soltar em Concluída e não informar o resultado: a ação só conclui com o resultado preenchido.', 33)
) AS v(chave, rota, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
