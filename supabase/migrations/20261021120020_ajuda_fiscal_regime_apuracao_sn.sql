-- Proplay (Canal PS d4732025): "?" (RD-95) nos campos do Simples da Configuração Fiscal —
-- Opção SN, Regime de apuração do Simples (regApTribSN 1/2/3) e % total de tributos.
-- Só ajuda de tela (aditiva): nenhuma regra de cálculo ou de emissão muda.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Configuração Fiscal', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/configuracoes/fiscal', 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.config.opcao_sn', 'Opção pelo Simples Nacional',
  'Escolha como a empresa está enquadrada: 1 = não optante (Lucro Presumido ou Real), 2 = MEI, 3 = ME/EPP optante do Simples. Confira no cartão CNPJ ou com o contador.',
  'Vai em toda NFS-e (campo opSimpNac). Com 2 ou 3 aparecem o regime de apuração e o % de tributos, que só valem para o Simples.',
  '3 · ME/EPP optante', 'Marcar "não optante" numa empresa do Simples: a nota sai com a tributação errada e a prefeitura pode rejeitar.', 1),
 ('fiscal.config.regime_apuracao_sn', 'Regime de apuração do Simples',
  'Como o Simples recolhe os tributos da nota: 1 = federais e ISS pelo Simples (o mais comum), 2 = federais pelo Simples e ISS por fora, 3 = federais e ISS por fora. Na dúvida, confirme com o contador; quase todas as empresas usam 1.',
  'Vai em toda NFS-e (campo regApTribSN). Com 1, a nota usa a alíquota do Simples do mês; com 2 ou 3, a alíquota municipal do ISS. Vazio aparece no pré-voo da Configuração Fiscal como pendência.',
  '1 · Fed + ISS pelo SN', 'Deixar vazio, ou escolher 2/3 sem a empresa recolher o ISS por fora: a nota é rejeitada ou sai com o ISS errado.', 2),
 ('fiscal.config.pct_tributos_sn', 'Percentual total aproximado de tributos',
  'O percentual aproximado de tributos sobre o valor da nota (Lei da Transparência), em números, com vírgula. Use a alíquota efetiva do Simples informada pelo contador.',
  'Aparece na nota como informação ao consumidor do valor aproximado dos tributos. Não muda o cálculo do imposto.',
  '8,55', 'Digitar o valor em reais em vez do percentual.', 3)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
