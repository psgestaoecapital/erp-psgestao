-- Indústria · /dashboard/industrial/folha — tabela "Por verba": chaves de ajuda RD-95 ("?") para as 3 colunas
-- (Verba, Tipo, Total), que ainda não tinham "?" por coluna (só o título da seção tinha). ADITIVO e idempotente:
-- só linhas novas em erp_ajuda_campo (ON CONFLICT DO NOTHING). Nenhuma função/view/policy muda. Nenhum dado de salário é tocado.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum) VALUES
 ('industrial.folha.col_verba', '/dashboard/industrial/folha', 'Verba',
  'Coluna — não se preenche aqui.', 'Nome da verba da folha (salário, horas extras, INSS, FGTS, descontos…) somada na competência.',
  'Salário base, Hora extra 50%.', 'Verbas com o mesmo nome em arquivos diferentes podem aparecer separadas se o código for diferente.'),
 ('industrial.folha.col_tipo', '/dashboard/industrial/folha', 'Tipo',
  'Coluna — não se preenche aqui.', 'Se a verba soma (provento/encargo) ou subtrai (desconto) no custo da folha. Desconto aparece em vermelho.',
  'Provento, desconto, encargo.', 'Classificar um desconto como provento infla o custo total da folha.'),
 ('industrial.folha.col_total', '/dashboard/industrial/folha', 'Total',
  'Coluna — não se preenche aqui.', 'Soma do valor da verba na competência, considerando todos os funcionários.',
  'R$ 42.000 em horas extras no mês.', 'O total vem do arquivo importado; se estiver errado, confira a planilha e reimporte a competência.')
ON CONFLICT (chave) DO NOTHING;
