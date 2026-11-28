-- RD-95: ajuda "?" da ação NOVA "mostrar/ocultar contas sem movimento no período" na tela do Caixa do grupo.
-- Aditiva e idempotente (ON CONFLICT DO NOTHING); não altera dado de cliente.
-- Contexto: aud8 26/11 (DEMO Comércio GE) — a lista "Por conta bancária" enterrava as contas reais no meio de
-- dezenas de contas zeradas (ex.: contas de revenda). O front passa a esconder as contas sem movimento no período
-- atrás de um botão; este "?" explica o controle ao usuário.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/caixa-grupo', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('financeiro.caixa_grupo.sem_movimento', 'Ações', 'Contas sem movimento no período',
  'Não se preenche: é um botão. Clique para mostrar ou esconder as contas da empresa que ficaram zeradas no período (sem saldo, sem entrada, sem saída e sem extrato).',
  'Deixar à vista só as contas que você realmente usa. As contas paradas ficam escondidas para não atrapalhar a leitura, mas continuam a um clique.',
  '"▸ Mostrar 48 contas sem movimento no período" → clica e elas aparecem; clica de novo para esconder.',
  'Achar que a conta sumiu: ela só está recolhida. Se a sua conta não aparece, é porque não teve movimento no período — clique para mostrar.', 15)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
