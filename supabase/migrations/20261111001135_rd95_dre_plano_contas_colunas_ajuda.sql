-- RD-95: "?" nas colunas do Plano de Contas Gerenciais (/dashboard/dre-divisional/plano-contas).
-- Gap do auditor aud8claudeps (nota 86): a árvore de contas mostra Código, Conta e o selo Tipo
-- (padrão/custom) sem "?". Os campos do modal de cadastro (nome/descrição) e o "+ sub" já tinham ajuda;
-- faltavam os cabeçalhos de coluna. ADITIVA: só o texto do "?" (RD-95), sem tabela, função ou dado de
-- cliente — a tela já lê psgc_contas / psgc_contas_custom pela RLS da empresa.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Plano de Contas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/dre-divisional/plano-contas', 'financeiro', 'publicado'
FROM (VALUES
  ('dre.plano_contas.codigo', 'Código da conta',
   'Nada a preencher: é o código gerencial da conta na árvore (gerado automaticamente). Contas com mais pontos são subcontas da conta acima.',
   'Organiza a hierarquia da DRE e a ordem das linhas no relatório. O código define o nível (1 = grupo, 1.1 = subconta) e por onde o valor entra no cálculo.',
   '3 = Deduções da Receita; 3.1 = Impostos sobre Vendas (subconta de 3).',
   'Tentar reaproveitar o código de uma conta padrão para outra finalidade: as contas padrão são fixas, você só cria subcontas sob elas.', 5),
  ('dre.plano_contas.conta', 'Conta',
   'Nada a preencher aqui: é o nome da conta/subconta. Para criar uma subcontinha da sua empresa use o botão "+ sub" na linha da conta padrão.',
   'É o nome que aparece na DRE. As contas padrão dão a base do cálculo; as subcontas deixam a DRE no vocabulário da sua empresa sem alterar a base.',
   'Sob "Despesas Fixas" (padrão) você cria "Aluguel da Loja" e "Energia da Fábrica" (custom).',
   'Criar a mesma subconta em dois grupos diferentes: escolha o grupo padrão certo antes do "+ sub".', 10),
  ('dre.plano_contas.tipo', 'Tipo (padrão / custom)',
   'Nada a preencher: o selo mostra se a conta é PADRÃO (fixa, base da DRE, não editável/removível) ou CUSTOM (criada pela sua empresa, pode editar e remover).',
   'Deixa claro o que você pode mexer. Só as contas custom têm os botões Editar e Remover; as padrão são protegidas para não quebrar o cálculo da DRE.',
   'Padrão: "Receita Operacional Bruta". Custom: "Cartão de Crédito" que você criou sob Despesas.',
   'Esperar editar uma conta padrão: ela é fixa. Crie uma subconta custom sob ela se precisar detalhar.', 15)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
