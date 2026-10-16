-- Chamados #3177/#3181 (Frioeste) · Plano de Ação: visão Quadro/Tabela e arraste do cartão.
-- ADITIVA: só o texto do "?" (RD-95) do seletor de visão. Sem tabela, função ou dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Plano de Ação 5W2H', 'Visão: Quadro / Tabela', v.o_que, v.para_que, v.exemplo, v.erro, 20,
       '/dashboard/industrial/plano-acao', 'industrial', 'publicado'
FROM (VALUES
 ('industrial.plano_acao.visao',
  'Escolha como ver as ações: Quadro (cartões por status) ou Tabela (uma linha por ação).',
  'No Quadro, arraste o cartão para outra coluna e o status muda (para concluir, o sistema pede o resultado). Na Tabela, veja tudo lado a lado, como numa planilha. Os filtros valem nas duas.',
  'Na reunião, use a Tabela para revisar prazos; no dia a dia, o Quadro para mover as ações.',
  'Soltar o cartão em "Concluída" abre a janela do resultado: sem preencher, a ação não conclui.')
) AS v(chave, o_que, para_que, exemplo, erro)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
