-- Gestão Empresarial · hub (/dashboard/gestao-empresarial, GestaoEmpresarialHubClient) · PDCA aud8claudeps (07/11):
-- o hub da GE (visão sem plano / seleção consolidada) mostrava 9 indicadores (Módulos totais, Em construção,
-- Previstos, Evolução média, Fluxo realizado, DRE divisional, Financiamentos, Contas a pagar, Contas a receber)
-- SEM o "?" (RD-95): 0 usos de AjudaCampo no componente. Esta PR põe o "?" em cada indicador; o texto vem do banco.
-- Aqui ficam as 9 chaves novas.
--
-- ADITIVA (RD-94.1-c): só texto de ajuda novo em erp_ajuda_campo; não altera tabela/função nem toca dado de cliente.
-- Idempotente: ON CONFLICT (chave) DO NOTHING.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('ge.hub.modulos_totais', 'Resumo da área', 'Módulos totais',
  'Nada a preencher: é a contagem de todos os módulos previstos para a Gestão Empresarial da sua empresa.',
  'Dá a dimensão do que a área entrega no total — a base para ler quantos já estão prontos e quantos faltam.',
  'Se a área prevê 12 módulos, o indicador mostra 12.',
  'Confundir "totais" com "prontos": este número não cai quando um módulo fica pronto, ele é o total planejado.', 1, '/dashboard/gestao-empresarial'),
 ('ge.hub.modulos_em_construcao', 'Resumo da área', 'Em construção',
  'Nada a preencher: quantos módulos da área estão sendo desenvolvidos agora.',
  'Mostra o que está em andamento — o que deve ficar disponível em breve na sua empresa.',
  'Se 3 módulos estão em desenvolvimento, o indicador mostra 3.',
  'Esperar usar o módulo só porque está "em construção": ele ainda não está liberado; acompanhe pela evolução.', 2, '/dashboard/gestao-empresarial'),
 ('ge.hub.modulos_previstos', 'Resumo da área', 'Previstos',
  'Nada a preencher: quantos módulos ainda estão no planejamento, sem desenvolvimento iniciado.',
  'Mostra o que vem pela frente na área, para você saber o que ainda está no roteiro.',
  'Se 4 módulos estão planejados e nenhum começou, o indicador mostra 4.',
  'Achar que "previsto" já funciona: é só o que está no plano, ainda não entregue nem em construção.', 3, '/dashboard/gestao-empresarial'),
 ('ge.hub.evolucao_media', 'Resumo da área', 'Evolução média',
  'Nada a preencher: é a média de quanto os módulos da área já avançaram, em porcentagem.',
  'Resume num só número o quanto a Gestão Empresarial já está pronta para a sua empresa.',
  'Se metade dos módulos está completa e a outra metade pela metade, a evolução média fica em torno de 75%.',
  'Ler como "quanto falta": o número é quanto JÁ evoluiu (100% = tudo pronto), não o que resta.', 4, '/dashboard/gestao-empresarial'),
 ('ge.hub.fluxo_realizado', 'Base operacional', 'Fluxo realizado',
  'Nada a preencher: quantos lançamentos de fluxo de caixa realizado a empresa já tem no sistema.',
  'Mostra se o fluxo de caixa já tem dado real lançado — base para as projeções e relatórios financeiros.',
  'Se a empresa já lançou 120 movimentos de caixa, o indicador mostra 120.',
  'Confundir com saldo: é a QUANTIDADE de lançamentos, não o valor em reais.', 5, '/dashboard/gestao-empresarial'),
 ('ge.hub.dre_divisional', 'Base operacional', 'DRE divisional',
  'Nada a preencher: quantos registros alimentam o DRE (Demonstração do Resultado) por negócio da empresa.',
  'Indica se o resultado por negócio já tem dado suficiente para o DRE divisional fazer sentido.',
  'Se há 300 lançamentos classificados para o DRE, o indicador mostra 300.',
  'Esperar o DRE completo com poucos registros: sem lançamentos classificados, o resultado por negócio fica incompleto.', 6, '/dashboard/gestao-empresarial'),
 ('ge.hub.financiamentos', 'Base operacional', 'Financiamentos',
  'Nada a preencher: quantos contratos de financiamento a empresa tem cadastrados.',
  'Mostra se os financiamentos da empresa já estão registrados para entrarem no fluxo e no resultado.',
  'Se a empresa cadastrou 2 financiamentos, o indicador mostra 2.',
  'Achar que "0" é erro: empresa sem financiamento mostra 0 — é o dado honesto, não falha.', 7, '/dashboard/gestao-empresarial'),
 ('ge.hub.contas_pagar', 'Base operacional', 'Contas a pagar',
  'Nada a preencher: quantos títulos a pagar a empresa tem lançados.',
  'Mostra se o contas a pagar já tem movimento — base para o fluxo de caixa e os alertas de vencimento.',
  'Se há 45 títulos a pagar cadastrados, o indicador mostra 45.',
  'Confundir com o total devido em reais: aqui é a QUANTIDADE de títulos, não a soma dos valores.', 8, '/dashboard/gestao-empresarial'),
 ('ge.hub.contas_receber', 'Base operacional', 'Contas a receber',
  'Nada a preencher: quantos títulos a receber a empresa tem lançados.',
  'Mostra se o contas a receber já tem movimento — base para o fluxo de caixa e a cobrança.',
  'Se há 60 títulos a receber cadastrados, o indicador mostra 60.',
  'Confundir com o total a receber em reais: aqui é a QUANTIDADE de títulos, não a soma dos valores.', 9, '/dashboard/gestao-empresarial')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
