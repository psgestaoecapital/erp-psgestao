-- TELA 355 (CEO 21/11): "criar como cópia" na Nova Receita (paridade com a Nova Despesa).
-- RD-95: "?" do dropdown "Salvar / Salvar e lançar nova / Salvar e duplicar". Idempotente, aditiva.
INSERT INTO public.erp_ajuda_campo (rota, chave, grupo, ordem, rotulo, status, versao, exemplo, vertical, erro_comum, para_que_serve, o_que_preencher)
VALUES (
  '/dashboard/financeiro/nova-receita',
  'financeiro.receita.salvar_opcoes',
  'Financeiro · Nova receita',
  35,
  'Opções de salvar',
  'publicado',
  1,
  'Lançar as 12 mensalidades do ano: salve a primeira com "Salvar e duplicar" e só troque o vencimento nas próximas.',
  'gestao_empresarial',
  'Usar "Salvar e duplicar" e esquecer de trocar o vencimento: nasce uma receita repetida com a data da anterior.',
  'Lança várias receitas seguidas sem sair da tela — em branco quando são diferentes, como cópia quando são parecidas.',
  'Abre as formas de salvar: "Salvar e lançar nova" grava esta e abre o formulário em branco; "Salvar e duplicar" grava esta e mantém os mesmos dados para você só ajustar e salvar outra.'
)
ON CONFLICT (chave) DO NOTHING;
