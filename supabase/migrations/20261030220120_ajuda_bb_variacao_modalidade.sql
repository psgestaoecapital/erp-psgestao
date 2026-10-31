-- RD-95 · "?" dos campos novos da configuração do BB (#5404): variação da carteira, modalidade, carteira só número.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, status) VALUES
 ('banco.variacao_carteira', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Variação da carteira',
  'O número da variação da carteira de cobrança do convênio no Banco do Brasil.',
  'O BB exige a variação junto com a carteira para registrar o boleto. Cada ambiente (teste e produção) guarda a sua.',
  '35 (convênio de teste).',
  'Usar a variação do teste na produção, ou o contrário: o banco recusa o boleto.',
  'financeiro', 'publicado'),
 ('banco.modalidade_boleto', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Modalidade do boleto',
  'Como o boleto é registrado no BB: 1 = simples, 4 = vinculada.',
  'Define o tipo de cobrança no registro. Na dúvida, use 1 (simples).',
  '1.',
  'Escolher vinculada sem o convênio ser desse tipo: o banco recusa o registro.',
  'financeiro', 'publicado'),
 ('banco.carteira_numero', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Carteira (só o número)',
  'O número da carteira de cobrança, sem dígito verificador nem texto.',
  'É enviado ao banco como número no registro do boleto.',
  '17.',
  'Escrever 17/01-9: o sistema usa só o 17, mas confira o contrato.',
  'financeiro', 'publicado')
ON CONFLICT (chave) DO NOTHING;
