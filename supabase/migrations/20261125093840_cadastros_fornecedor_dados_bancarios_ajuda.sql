-- 20261125063540 · code-desenvolvedor-3 · PDCA GE (msg 33fa0faa) · /dashboard/cadastros/fornecedores (tela 188)
-- Requisito essencial do blueprint: "Conta bancária para pagamento — dados PIX/CC p/ TED".
-- erp_fornecedores JÁ tem banco/agencia/conta/pix; a tela (PessoaForm) passa a exibi-los e gravá-los.
-- Esta migration só SEMEIA o "?" (RD-95) dos 4 campos novos. Rota = a do formulário (ROTA_AJUDA do PessoaForm),
-- igual às demais chaves cadastros.pessoa.*. Aditiva e idempotente; não cria função, não toca RLS nem dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('cadastros.pessoa.banco', '/dashboard/cadastros/pessoa', 'Dados bancários', 'Banco',
  'O banco onde o fornecedor recebe: o nome ou o código de 3 dígitos.',
  'Saber para qual banco pagar o fornecedor (TED) sem pedir a conta de novo a cada título.',
  '756 Sicoob', 'Anotar o banco de quem PAGA (a sua empresa) em vez do banco de quem RECEBE (o fornecedor).', 'cadastros', 40, 1, 'publicado'),
 ('cadastros.pessoa.agencia', '/dashboard/cadastros/pessoa', 'Dados bancários', 'Agência',
  'O número da agência do fornecedor, com o dígito se o banco usar.',
  'Completa os dados da TED para o pagamento chegar à conta certa.',
  '3069', 'Trocar a agência pela conta, ou deixar de fora o dígito quando o banco exige.', 'cadastros', 41, 1, 'publicado'),
 ('cadastros.pessoa.conta', '/dashboard/cadastros/pessoa', 'Dados bancários', 'Conta (com dígito)',
  'O número da conta corrente do fornecedor, com o dígito verificador.',
  'Com banco, agência e conta, o contas a pagar consegue pagar por TED sem redigitar os dados.',
  '12345-6', 'Esquecer o dígito ou digitar a conta de outra empresa do mesmo grupo — confira o CNPJ do titular.', 'cadastros', 42, 1, 'publicado'),
 ('cadastros.pessoa.pix', '/dashboard/cadastros/pessoa', 'Dados bancários', 'Chave PIX',
  'A chave PIX do fornecedor: CNPJ/CPF, e-mail, celular ou chave aleatória.',
  'Pagar o fornecedor por PIX, na hora, sem precisar dos dados de agência e conta.',
  '12.345.678/0001-90', 'Usar uma chave PIX que não é do fornecedor (ex.: de um vendedor). Na dúvida, confirme por telefone antes de pagar.', 'cadastros', 43, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, atualizado_em = now();
